// Offline audit evidence. No network requests are made: all fetch calls are mocks.
// Only this script's JSON report is written; application source is read unchanged.
// Run from the repository root with: node .docs/security-evidence/reproduce-client.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(outputDirectory, '..', '..');
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8').replaceAll('\r\n', '\n');
const remoteSource = source('lib/remotePosts.ts');
const newSource = source('app/new/page.tsx');
const settingsSource = source('lib/settings.ts');
const detailSource = source('app/post/[id]/page.tsx');
const checks = [];

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Source boundary missing: ${start}`);
  return text.slice(from, to).trim();
}

function replaceExact(text, from, to) {
  assert(text.includes(from), `Type annotation missing: ${from}`);
  return text.replace(from, to);
}

// These are direct source blocks. Only TypeScript annotations/type assertions
// and the export keyword are removed. No TypeScript dependency is installed.
let myIds = between(remoteSource, 'export function getMyPostIds()', 'function rememberMyPost(');
myIds = replaceExact(myIds, 'export function getMyPostIds(): string[]', 'function getMyPostIds()');
myIds = replaceExact(myIds, '(JSON.parse(raw) as string[])', '(JSON.parse(raw))');
let remember = between(remoteSource, 'function rememberMyPost(', 'function forgetMyPost(');
remember = replaceExact(remember, 'id: string): void', 'id)');
let mine = between(remoteSource, 'export function isMyPost(', '// 削除用の合言葉');
mine = replaceExact(mine, 'export function isMyPost(id: string): boolean', 'function isMyPost(id)');
let readTokens = between(remoteSource, 'function readTokens()', 'function writeTokens(');
readTokens = replaceExact(readTokens, '(): Record<string, string>', '()');
readTokens = replaceExact(readTokens, '(JSON.parse(raw) as Record<string, string>)', '(JSON.parse(raw))');
let writeTokens = between(remoteSource, 'function writeTokens(', 'function newToken()');
writeTokens = replaceExact(writeTokens, '(map: Record<string, string>): void', '(map)');
let newToken = between(remoteSource, 'function newToken()', 'async function sha256Hex(');
newToken = replaceExact(newToken, '(): string', '()');
let sha256 = between(remoteSource, 'async function sha256Hex(', '/** 削除できる投稿か。');
sha256 = replaceExact(sha256, '(text: string): Promise<string>', '(text)');
let canDelete = between(remoteSource, 'export function canDeletePost(', 'export type RemotePost =');
canDelete = replaceExact(canDelete, 'export function canDeletePost(id: string): boolean', 'function canDeletePost(id)');
let create = between(remoteSource, 'export async function createRemotePost(', '/**\n * 自分の投稿を消す。');
create = replaceExact(create, 'export async function createRemotePost(\n  p: NewRemotePost\n): Promise<{ ok: boolean; error?: string }>', 'async function createRemotePost(p)');
create = replaceExact(create, 'let token: string | null', 'let token');
create = replaceExact(create, 'let tokenHash: string | null', 'let tokenHash');

const createCode = [myIds, remember, mine, readTokens, writeTokens, newToken, sha256, canDelete, create].join('\n');
const minimalPost = { id: 'synthetic-audit-post', title: 'synthetic', body: 'synthetic', tag: 'test', area: 'test', categories: [], isIndoor: false, minutes: 30, budget: 0, timeOfDay: [], who: [] };

async function createCheck(mode) {
  const stored = new Map();
  let requests = 0;
  let postedHashIsNull = false;
  const context = vm.createContext({
    MINE_KEY: 'kyoto-repeater/myPostIds', TOKENS_KEY: 'kyoto-repeater/postTokens',
    TABLE: 'https://offline.invalid/posts', HEADERS: {}, Uint8Array, TextEncoder,
    crypto: mode === 'crypto-unavailable' ? { getRandomValues() { throw new Error('synthetic unavailable crypto'); } } : webcrypto,
    window: { localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) {
        if (mode === 'storage-unavailable') throw new Error('synthetic QuotaExceededError');
        stored.set(key, value);
      },
    } },
    fetch: async (_url, options) => {
      requests += 1;
      postedHashIsNull = JSON.parse(options.body).delete_token_hash === null;
      return { ok: true };
    },
  });
  vm.runInContext(createCode, context, { timeout: 1000, filename: 'remotePosts-extracted-source.js' });
  const result = await context.createRemotePost(minimalPost);
  const deletable = context.canDeletePost(minimalPost.id);
  assert.equal(result.ok, true);
  assert.equal(requests, 1);
  assert.equal(deletable, mode === 'normal');
  assert.equal(postedHashIsNull, mode === 'crypto-unavailable');
  return { mode, ok: result.ok, mockedPostRequests: requests, canDeletePost: deletable, postedHashIsNull, storedToken: stored.has('kyoto-repeater/postTokens') };
}

for (const mode of ['normal', 'storage-unavailable', 'crypto-unavailable']) {
  checks.push({ id: `post-deletion-capability-${mode}`, kind: 'executed-source-with-mocks', passed: true, actual: await createCheck(mode) });
}

const submit = between(newSource, 'const submit = async () => {', 'if (done) {');
assert(settingsSource.includes('sharePlace: boolean;'));
assert(settingsSource.includes("const KEY = 'kyoto-repeater/settings';"));
for (const place of ['京都府（synthetic general area）', '']) {
  let payload;
  let settingsReads = 0;
  const settings = { sharePlace: false };
  const geo = { lat: 35.1234567, lng: 135.7654321 };
  const context = vm.createContext({
    setSending() {}, setError() {}, notify() {}, setDone() {},
    title: 'synthetic', body: 'synthetic', place, geo, categories: ['quiet'],
    isIndoor: false, minutes: 30, budget: 0, timeOfDay: 'day', who: 'solo', photo: null,
    getSettings() { settingsReads += 1; return settings; },
    window: { localStorage: { getItem(key) { return key === 'kyoto-repeater/settings' ? JSON.stringify(settings) : null; } } },
    createRemotePost: async (value) => { payload = value; return { ok: true }; },
  });
  vm.runInContext(`${submit}\nglobalThis.auditSubmit = submit;`, context, { timeout: 1000, filename: 'new-page-submit-extracted-source.js' });
  await context.auditSubmit();
  assert.equal(payload.lat, geo.lat);
  assert.equal(payload.lng, geo.lng);
  assert.equal(settingsReads, 0);
  assert.equal(payload.place, place || '35.12346, 135.76543');
  checks.push({ id: place ? 'opt-out-edited-place-keeps-original-gps' : 'opt-out-empty-place-reinserts-gps', kind: 'executed-source-with-mocks', passed: true, actual: { sharePlace: settings.sharePlace, settingsReads, submittedPlace: payload.place, submittedLat: payload.lat, submittedLng: payload.lng } });
}

let convertRow = between(remoteSource, 'function toPost(', '/** みんなの投稿を新しい順に取得する。');
convertRow = replaceExact(convertRow, '(r: Row): RemotePost', '(r)');
for (const type of ['categories', 'timeOfDay', 'who']) convertRow = replaceExact(convertRow, ` as Post['${type}']`, '');
convertRow = replaceExact(convertRow, '(r.budget as 0 | 1 | 2)', '(r.budget)');
let fetchList = between(remoteSource, 'export async function fetchRemotePosts(', 'export async function fetchRemotePost(');
fetchList = replaceExact(fetchList, 'export async function fetchRemotePosts(limit = 60): Promise<RemotePost[]>', 'async function fetchRemotePosts(limit = 60)');
fetchList = replaceExact(fetchList, '(await res.json()) as Row[]', '(await res.json())');
let requestedQuery;
const syntheticRow = { ...minimalPost, place: 'synthetic location', map_query: 'synthetic map query', body: 'synthetic full private body', lat: 35.1234567, lng: 135.7654321, time_of_day: [], photo_data_url: null, created_at: '2000-01-01T00:00:00.000Z', reactions: 0, is_indoor: false };
const readContext = vm.createContext({ TABLE: 'https://offline.invalid/posts', HEADERS: {}, fetch: async (url) => { requestedQuery = new URL(url).search; return { ok: true, json: async () => [syntheticRow] }; } });
vm.runInContext(`${convertRow}\n${fetchList}`, readContext, { timeout: 1000 });
const rows = await readContext.fetchRemotePosts();
assert.equal(rows[0].body, syntheticRow.body);
assert.equal(rows[0].place, syntheticRow.place);
assert.equal(rows[0].lat, syntheticRow.lat);
assert(requestedQuery.includes('select=*'));
assert(detailSource.includes('<p className="paywall-preview">{post.body}</p>'));
checks.push({ id: 'locked-content-delivered-in-full', kind: 'executed-fetch-conversion-with-mocks-and-source-assertion', passed: true, actual: { querySelectsEveryColumn: true, fullBodyReturnedBeforeUnlock: true, placeReturnedBeforeUnlock: true, exactGpsReturnedBeforeUnlock: true, closedPaywallInterpolatesEntireBody: true } });

const report = {
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  scope: 'Offline source extraction with fetch/localStorage/React-state mocks; not an end-to-end browser or live database test.',
  networkRequests: 0,
  applicationSourceChanged: false,
  transpilation: 'No third-party transpiler. The script validates and removes only exact TypeScript annotations in extracted functions; submit callback is unmodified JavaScript.',
  sourceSha256: Object.fromEntries(['lib/remotePosts.ts', 'app/new/page.tsx', 'lib/settings.ts', 'app/post/[id]/page.tsx'].map((file) => [file, createHash('sha256').update(source(file)).digest('hex')])),
  checks,
};
fs.writeFileSync(path.join(outputDirectory, 'client-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, passed: checks.every((check) => check.passed), networkRequests: 0, report: '.docs/security-evidence/client-checks.json' }));
