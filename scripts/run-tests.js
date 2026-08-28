const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed += 1; }
  else { failed += 1; console.error('  ✗ ' + message); }
}
function section(name) { console.log('\n' + name); }

(async function () {
  const root = path.resolve(__dirname, '..');

  // ---- load worker helpers (copy to .mjs so Node imports it as ESM) ----
  const tmp = path.join(os.tmpdir(), 'familytree-worker-test.mjs');
  fs.copyFileSync(path.join(root, 'worker.js'), tmp);
  const worker = await import('file://' + tmp.replace(/\\/g, '/'));
  fs.unlinkSync(tmp);

  section('validYear');
  assert(worker.validYear('') === true, 'empty year allowed');
  assert(worker.validYear('1900') === true, 'four-digit year allowed');
  assert(worker.validYear('12') === true, 'short year allowed');
  assert(worker.validYear('19ab') === false, 'non-numeric rejected');
  assert(worker.validYear('19000') === false, 'over four digits rejected');

  section('safeContentType');
  assert(worker.safeContentType('image/jpeg') === 'image/jpeg', 'jpeg allowed');
  assert(worker.safeContentType('image/webp') === 'image/webp', 'webp allowed');
  assert(worker.safeContentType('image/svg+xml') === null, 'svg rejected');
  assert(worker.safeContentType('text/html') === null, 'html rejected');
  assert(worker.safeContentType('image/jpeg; charset=utf-8') === 'image/jpeg', 'params stripped');
  assert(worker.safeContentType('IMAGE/PNG') === 'image/png', 'case-insensitive');

  section('reorderIdsValid');
  assert(worker.reorderIdsValid([3, 1, 2], [1, 2, 3]) === true, 'same set reordered is valid');
  assert(worker.reorderIdsValid([1, 2, 3], [1, 2]) === false, 'missing id invalid');
  assert(worker.reorderIdsValid([1, 2, 3], [1, 2, 4]) === false, 'different set invalid');
  assert(worker.reorderIdsValid([1, 2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1, 99]) === false, 'over six ids invalid');
  assert(worker.reorderIdsValid([1, 2], [2, 1]) === true, 'two ids valid');

  section('rateLimited');
  const key = 'test-key-' + Date.now();
  for (let i = 0; i < 5; i++) worker.rateLimited(key, 'default');
  assert(worker.rateLimited(key, 'default') === false, 'within limit not blocked');
  for (let i = 0; i < 100; i++) worker.rateLimited(key + '-flood', 'default');
  assert(worker.rateLimited(key + '-flood', 'default') === true, 'over limit blocked');

  section('family-data integrity');
  const source = fs.readFileSync(path.join(root, 'family-data.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const people = context.window.FAMILY_DATA || [];
  const ids = people.map((p) => p.id);
  const byId = {};
  people.forEach((p) => { byId[p.id] = p; });
  assert(ids.length === new Set(ids).size, 'no duplicate people ids');
  const missingRefs = [];
  people.forEach((p) => {
    if (typeof p.spouse === 'string' && p.spouse && !byId[p.spouse]) missingRefs.push(p.id + '->spouse');
    ['children', 'parents', 'siblings'].forEach((k) => (p[k] || []).forEach((r) => { if (!byId[r]) missingRefs.push(p.id + '->' + k); }));
  });
  assert(missingRefs.length === 0, 'no missing id references (' + missingRefs.join(', ') + ')');
  const rootPerson = people.find((p) => p.id === 'padmanabh');
  assert(!!rootPerson, 'root person padmanabh present');

  console.log('\n------------------------------------');
  if (failed) {
    console.log('FAIL: ' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
  }
  console.log('PASS: all ' + passed + ' assertions passed');
})();
