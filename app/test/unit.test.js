// Fast unit tests: node --test test/unit.test.js
const test = require('node:test');
const assert = require('node:assert');
require('./helpers').tempData('unit');
const { seal, open, sign, unsign, hashPassword, checkPassword } = require('../src/crypto');
const { wantOn } = require('../src/live/engine');

test('seal/open round trip, tamper fails', () => {
  const s = seal({ key: 'abc', n: 1 });
  assert.deepStrictEqual(open(s), { key: 'abc', n: 1 });
  const b = Buffer.from(s, 'base64'); b[b.length - 1] ^= 1;
  assert.throws(() => open(b.toString('base64')));
});

test('sign/unsign rejects changes', () => {
  const t = sign('1:123');
  assert.strictEqual(unsign(t), '1:123');
  assert.strictEqual(unsign(t.replace('1:123', '1:999')), null);
  assert.strictEqual(unsign('garbage'), null);
});

test('password hash', () => {
  const h = hashPassword('hello world 1');
  assert.ok(checkPassword('hello world 1', h));
  assert.ok(!checkPassword('hello world 2', h));
});

const at = (d, h, m) => { const x = new Date(2026, 10, 2 + ((d - 1) % 7), h, m); return x; };  // 2026-11-02 is Monday
test('CSV parser: quotes, commas, new lines, BOM', () => {
  const { parseCSV } = require('../src/upload/scheduler');
  const r = parseCSV('\uFEFFfile,title,description\r\n#1,"Hi, there","say ""yo""\nline 2"\n\n#2,b,\n');
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r[0], { file: '#1', title: 'Hi, there', description: 'say "yo"\nline 2' });
  assert.strictEqual(r[1].title, 'b');
});

test('schedule: always / manual', () => {
  assert.strictEqual(wantOn({ schedule: '{"mode":"always"}', want_on: 0 }), true);
  assert.strictEqual(wantOn({ schedule: '{"mode":"manual"}', want_on: 1 }), true);
  assert.strictEqual(wantOn({ schedule: '{"mode":"manual"}', want_on: 0 }), false);
});
test('schedule: daily window', () => {
  const st = { schedule: JSON.stringify({ mode: 'daily', start: '08:00', end: '23:00', days: [1, 2, 3, 4, 5] }) };
  assert.strictEqual(wantOn(st, at(1, 7, 59)), false);
  assert.strictEqual(wantOn(st, at(1, 8, 0)), true);
  assert.strictEqual(wantOn(st, at(5, 22, 59)), true);
  assert.strictEqual(wantOn(st, at(5, 23, 0)), false);
  assert.strictEqual(wantOn(st, at(6, 12, 0)), false);   // Saturday off
});
test('schedule: window across midnight', () => {
  const st = { schedule: JSON.stringify({ mode: 'daily', start: '22:00', end: '02:00', days: [5] }) };  // Friday night
  assert.strictEqual(wantOn(st, at(5, 23, 30)), true);
  assert.strictEqual(wantOn(st, at(6, 1, 30)), true);    // Saturday 01:30 belongs to Friday's window
  assert.strictEqual(wantOn(st, at(6, 23, 30)), false);
  assert.strictEqual(wantOn(st, at(5, 1, 30)), false);   // Friday 01:30 belongs to Thursday (off)
});
