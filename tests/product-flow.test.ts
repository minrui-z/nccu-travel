import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicExample } from '../lib/public-example';
import { calculateClaim } from '../lib/claim/claim-engine';
import { fieldInputMode, fieldRequirement } from '../lib/field-metadata';
import { reportErrorMessage } from '../lib/report-errors';
import { buildClaimChanges } from '../lib/xls/claim-mapping';
import { fitClaimText } from '../lib/xls/text-fitting';
import { readFileSync } from 'node:fs';

test('public examples show coherent capped amounts, distinct rates, and private day without claim values', () => {
  for (const kind of ['general', 'student'] as const) {
    const draft = createPublicExample(kind);
    const result = calculateClaim(draft);
    assert.deepEqual(result.issues.filter((issue) => issue.severity === 'error'), []);
    assert.equal(result.canExport, true);
    assert.equal(result.claimTwd, kind === 'student' ? 36000 : result.totalTwd);
    assert.equal(draft.days[2].kind, 'personal');
    assert.equal(draft.days[2].work, '個人行程');
    assert.equal(draft.days[2].usdRate, '');
    assert.equal(result.daily[2].netUsd, '0');
    assert.equal(draft.fx.rate, '31.5');
    assert.equal(draft.expenses[1].fxRate, '31.2');
    assert.equal(draft.expenses[2].fxRate, '31.7');
    const manifest = JSON.parse(readFileSync(`public/templates/${kind}-${draft.groups.length}.json`, 'utf8'));
    const fitted = fitClaimText(manifest, buildClaimChanges(draft, result, manifest));
    assert.deepEqual(fitted.issues, []);
  }
});

test('public example instances cannot mutate one another', () => {
  const first = createPublicExample('student');
  first.person.name = 'changed'; first.expenses[0].amount = '0';
  const next = createPublicExample('general');
  assert.equal(next.person.name, '陳怡安');
  assert.equal(next.expenses[0].amount, '22000');
});

test('input behavior and optional fields depend on field identity', () => {
  assert.equal(fieldInputMode('expenses.15.fxRate'), 'decimal');
  assert.equal(fieldInputMode('receiptCount'), 'numeric');
  assert.equal(fieldInputMode('person.identifier'), undefined);
  assert.equal(fieldRequirement('expenses.7.receipt'), 'optional');
  assert.equal(fieldRequirement('receiptCount'), 'optional');
  assert.equal(fieldRequirement('person.name'), 'required');
});

test('export errors never expose arbitrary lower-level messages', () => {
  for (const code of ['ExtSST missing at C19', new Error('Unicode'), undefined, { code: 'DBCell' }, 'constructor', '__proto__']) {
    assert.equal(reportErrorMessage(code), reportErrorMessage('file'));
  }
  assert.match(reportErrorMessage('template'), /重試/);
  assert.match(reportErrorMessage('invalid-claim'), /檢查與下載/);
});
