// Offline review harness. Every fetch is replaced; real keys are never read.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const routePath = new URL('../../app/api/reverse-geocode/route.ts', import.meta.url);
const original = readFileSync(routePath, 'utf8');
const substitutions = [
  ["import { NextRequest, NextResponse } from 'next/server';", ''],
  ["export const runtime = 'nodejs';", "const runtime = 'nodejs';"],
  ['export async function GET(req: NextRequest)', 'async function GET(req)'],
];
let executable = original;
for (const [before, after] of substitutions) {
  assert.equal(executable.split(before).length - 1, 1,
    'Route changed: review the harness substitutions before rerunning.');
  executable = executable.replace(before, after);
}
executable += '\nglobalThis.handler = GET;';

class NextResponseStub extends Response {
  static json(value, init) {
    return new NextResponseStub(JSON.stringify(value), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  }
}

const syntheticKey = 'OFFLINE_REVIEW_DUMMY_KEY_NOT_A_REAL_CREDENTIAL';
async function run(name, query, options = {}) {
  const calls = [];
  const context = vm.createContext({
    NextResponse: NextResponseStub,
    process: { env: options.noKey ? {} : { GOOGLE_MAPS_API_KEY: syntheticKey } },
    AbortSignal: { timeout: (timeoutMs) => ({ timeoutMs }) },
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      assert.ok(['places.googleapis.com', 'maps.googleapis.com'].includes(url.hostname));
      const body = init.body ? JSON.parse(init.body) : null;
      const coordinate = body?.locationRestriction?.circle?.center ??
        Object.fromEntries(['latitude', 'longitude'].map((key, i) =>
          [key, Number(url.searchParams.get('latlng').split(',')[i])]));
      calls.push({
        method: init.method ?? 'GET', host: url.hostname, path: url.pathname,
        coordinate, timeoutMs: init.signal?.timeoutMs,
        fieldMask: init.headers?.['X-Goog-FieldMask'] ?? null,
      });
      if (options.upstream === 'timeout') throw new Error('simulated timeout');
      if (url.hostname === 'places.googleapis.com') {
        return {
          ok: options.upstream !== 'place-http-error',
          json: async () => options.upstream === 'place' ? {
            places: [{ displayName: { text: 'Offline test place' }, shortFormattedAddress: 'Offline address' }],
          } : { places: [] },
        };
      }
      return {
        ok: true,
        json: async () => options.upstream === 'empty' ? { results: [] } : {
          results: [{ formatted_address: '日本、〒600-8001 京都府オフライン検証用' }],
        },
      };
    },
  });
  vm.runInContext(executable, context, { filename: 'reverse-geocode-route-under-review.js' });
  const results = [];
  for (let i = 0; i < (options.repeat ?? 1); i++) {
    const response = await context.handler({ nextUrl: new URL(`http://offline.invalid/api/reverse-geocode${query}`) });
    const responseText = await response.text();
    assert.ok(!responseText.includes(syntheticKey), 'Dummy key appeared in a response.');
    results.push({ status: response.status, body: responseText ? JSON.parse(responseText) : null });
  }
  assert.deepEqual(results.map((r) => r.status), Array(options.repeat ?? 1).fill(options.status ?? 200), name);
  assert.equal(calls.length, options.calls ?? 2, name);
  if (options.coordinate) assert.deepEqual(calls[0].coordinate, options.coordinate, name);
  return { name, query, repetitions: options.repeat ?? 1, responses: results, upstreamCallCount: calls.length, calls, verified: true };
}

const checks = [];
checks.push(await run('normal coordinates reach both upstream services', '?lat=35.0116&lng=135.7681'));
checks.push(await run('missing coordinates are coerced to zero', '', { coordinate: { latitude: 0, longitude: 0 } }));
checks.push(await run('missing longitude is coerced to zero', '?lat=35.0116', { coordinate: { latitude: 35.0116, longitude: 0 } }));
checks.push(await run('empty coordinates are coerced to zero', '?lat=&lng=', { coordinate: { latitude: 0, longitude: 0 } }));
checks.push(await run('whitespace coordinates are coerced to zero', '?lat=%20&lng=%20', { coordinate: { latitude: 0, longitude: 0 } }));
checks.push(await run('positive out-of-range coordinates reach upstream', '?lat=91&lng=181', { coordinate: { latitude: 91, longitude: 181 } }));
checks.push(await run('negative out-of-range coordinates reach upstream', '?lat=-91&lng=-181', { coordinate: { latitude: -91, longitude: -181 } }));
checks.push(await run('very large finite coordinates reach upstream', '?lat=1e300&lng=1e300', { coordinate: { latitude: 1e300, longitude: 1e300 } }));
checks.push(await run('nonnumeric coordinates are rejected', '?lat=abc&lng=135', { status: 400, calls: 0 }));
checks.push(await run('infinite coordinates are rejected', '?lat=Infinity&lng=135', { status: 400, calls: 0 }));
checks.push(await run('URL injection string is rejected', '?lat=http%3A%2F%2F127.0.0.1&lng=135', { status: 400, calls: 0 }));
checks.push(await run('query injection string is rejected', '?lat=35%26key%3Dattacker&lng=135', { status: 400, calls: 0 }));
checks.push(await run('no configured key makes no upstream call', '?lat=35&lng=135', { noKey: true, status: 204, calls: 0 }));
checks.push(await run('place result returns after one call', '?lat=35&lng=135', { upstream: 'place', calls: 1 }));
checks.push(await run('upstream HTTP error falls back to geocoding', '?lat=35&lng=135', { upstream: 'place-http-error' }));
checks.push(await run('no upstream result returns 204', '?lat=35&lng=135', { upstream: 'empty', status: 204 }));
checks.push(await run('upstream timeout is caught', '?lat=35&lng=135', { upstream: 'timeout', status: 204, calls: 1 }));
checks.push(await run('five identical anonymous calls cause ten upstream calls', '?lat=35.0116&lng=135.7681', { repeat: 5, calls: 10 }));

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'Route handler logic, executed in a VM with a minimal NextResponse replacement.',
  realNetworkCalls: 0,
  realCredentialsRead: false,
  limitations: [
    'Does not start Next.js or exercise its HTTP/cache layer.',
    'Does not inspect Vercel/WAF settings or Google key restrictions, quotas, billing, or live API behavior.',
    'Timeout signals are recorded and timeout failures are simulated; elapsed six-second behavior is not measured.',
    'Mock success for out-of-range input proves forwarding only, not Google acceptance or billing.',
  ],
  checkCount: checks.length,
  verifiedCheckCount: checks.filter((c) => c.verified).length,
  checks,
};
writeFileSync(new URL('./api-checks.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checkCount: report.checkCount, verifiedCheckCount: report.verifiedCheckCount, realNetworkCalls: 0, output: '.docs/security-evidence/api-checks.json' }, null, 2));
