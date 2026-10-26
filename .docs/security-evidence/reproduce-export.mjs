// Evaluate the CSV encoder with harmless synthetic input; no spreadsheet or network is opened.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const original = readFileSync(new URL('../../scripts/curate-spots.mjs', import.meta.url), 'utf8');
const encoder = original.split(/\r?\n/).find((line) => line.startsWith('const esc = '));
assert(encoder, 'CSV encoder not found: review harness before rerunning.');
const context = vm.createContext({});
vm.runInContext(`${encoder}\nglobalThis.encode = esc;`, context, { timeout: 1000 });
const input = '=1+1';
const actual = context.encode(input);
assert.equal(actual, '"=1+1"');
const result = {
  generatedAt: new Date().toISOString(),
  checkCount: 1,
  input,
  encodedCell: actual,
  formulaPrefixPreserved: true,
  networkRequests: 0,
  limitations: 'Only the actual encoder is evaluated. Formula execution in Excel and attacker control of a real Google listing are not tested.',
};
writeFileSync(new URL('./csv-checks.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
