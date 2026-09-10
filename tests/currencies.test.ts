import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CURRENCY_OPTIONS } from '../lib/currencies';
test('expense choices include every Bank of Taiwan quoted currency without duplicates', () => {
  const snapshot = JSON.parse(
    readFileSync(
      new URL('../public/data/fx/2026-09-08.json', import.meta.url),
      'utf8',
    ),
  );
  const codes = CURRENCY_OPTIONS.map(([code]) => code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(
    codes.filter((code) => !['TWD', 'OTHER'].includes(code)).sort(),
    Object.keys(snapshot.currencyRates).sort(),
  );
});
