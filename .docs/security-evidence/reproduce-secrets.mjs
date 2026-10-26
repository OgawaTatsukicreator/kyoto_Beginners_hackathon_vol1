// Read-only Git history scan. Match values and file contents are never printed or saved.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
const patterns = {
  googleKey: /AIza[0-9A-Za-z_-]{35}/,
  awsAccessId: /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  githubToken: /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
  privateKey: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  stripeSecret: /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  supabaseSecret: /sb_secret_[A-Za-z0-9_-]{16,}/,
  jwt: /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
  credentialUrl: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?):\/\/[^\s/@:]+:[^\s/@]+@/,
};
const commits = git('rev-list', '--all').toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const objects = new Set(git('rev-list', '--objects', '--all').toString('utf8').trim().split(/\r?\n/).map((line) => line.split(' ')[0]));
let textBlobs = 0;
const matches = [];
for (const object of objects) {
  if (!object || git('cat-file', '-t', object).toString('utf8').trim() !== 'blob') continue;
  const data = git('cat-file', 'blob', object);
  if (data.includes(0)) continue;
  textBlobs += 1;
  const text = data.toString('utf8');
  for (const [patternName, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) matches.push({ patternName, blobId: object });
  }
}
const trackedEnvironmentPaths = git('ls-files', '--', '.env', '.env.*', '**/.env', '**/.env.*').toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const workingRootEnvironmentFileCount = readdirSync(cwd, { withFileTypes: true }).filter((entry) => entry.isFile() && /^\.env(?:\.|$)/.test(entry.name)).length;
const result = {
  generatedAt: new Date().toISOString(),
  scope: 'All locally reachable Git refs; text blobs are identified by absence of NUL bytes. No live credentials are used.',
  commitCount: commits.length,
  textBlobCount: textBlobs,
  patternNames: Object.keys(patterns),
  matchCount: matches.length,
  matches,
  trackedEnvironmentFileCount: trackedEnvironmentPaths.length,
  workingRootEnvironmentFileCount,
  limitations: 'Pattern-based only. Does not rule out arbitrary passwords, encoded secrets, binary contents, unreachable Git objects, untracked files outside the root .env inventory, or un-fetched remote history.',
};
writeFileSync(new URL('./secret-scan-summary.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ commitCount: commits.length, textBlobCount: textBlobs, matchCount: matches.length, trackedEnvironmentFileCount: trackedEnvironmentPaths.length, workingRootEnvironmentFileCount }));
