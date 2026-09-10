import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allowanceFor } from '../lib/public-data';
const data = JSON.parse(
  await readFile(
    new URL('../public/data/allowances-2026.json', import.meta.url),
    'utf8',
  ),
);
test('Dubai unlisted August/September use UAE Other and October returns to city rate', () => {
  for (const [date, amount, fallback] of [
    ['2026-07-31', '368', false],
    ['2026-08-01', '341', true],
    ['2026-09-30', '341', true],
    ['2026-10-01', '368', false],
    ['2026-11-01', '493', false],
    ['2026-12-01', '590', false],
  ] as const) {
    const r = allowanceFor(data, 'foreign-155', date);
    assert.equal(r?.amount, amount);
    assert.equal(r?.fallback, fallback);
  }
});
test('San Sebastian listed season endpoints and unlisted season choose correct source', () => {
  for (const [date, amount, fallback] of [
    ['2026-03-31', '290', true],
    ['2026-04-01', '467', false],
    ['2026-10-31', '467', false],
    ['2026-11-01', '290', true],
  ] as const) {
    const r = allowanceFor(data, 'foreign-240', date);
    assert.equal(r?.amount, amount);
    assert.equal(r?.fallback, fallback);
    assert.equal(r?.source?.id, 'dgbas-foreign-2026');
  }
});
test('New York September boundary and Delhi cross-year season are exact', () => {
  assert.equal(allowanceFor(data, 'foreign-309', '2026-08-31')?.amount, '510');
  assert.equal(allowanceFor(data, 'foreign-309', '2026-09-01')?.amount, '580');
  assert.equal(allowanceFor(data, 'foreign-070', '2026-01-01')?.amount, '259');
  assert.equal(allowanceFor(data, 'foreign-070', '2026-03-31')?.amount, '259');
  assert.equal(allowanceFor(data, 'foreign-070', '2026-04-01')?.amount, '227');
  assert.equal(allowanceFor(data, 'foreign-070', '2026-09-01')?.amount, '259');
});
test('Country-wide Iceland seasonal and mainland/HK/Macau source remain distinct', () => {
  assert.equal(allowanceFor(data, 'foreign-229', '2026-04-30')?.amount, '285');
  assert.equal(allowanceFor(data, 'foreign-229', '2026-05-01')?.amount, '365');
  const hk = allowanceFor(data, 'mainland-hk-macau-17', '2026-07-01');
  assert.equal(hk?.amount, '339');
  assert.equal(hk?.source?.id, 'dgbas-mainland-hk-macau-2026');
  assert.equal(hk?.page, 1);
});
test('Pre-effective date, missing destination and malformed date return unavailable', () => {
  assert.equal(allowanceFor(data, 'foreign-006', '2025-12-31'), null);
  assert.equal(allowanceFor(data, 'not-an-id', '2026-01-01'), null);
  assert.equal(allowanceFor(data, 'foreign-006', 'invalid'), null);
  assert.equal(allowanceFor(data, 'foreign-006', '2026-02-30'), null);
});
