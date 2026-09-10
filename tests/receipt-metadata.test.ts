import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateClaim, createSampleDraft } from '../lib/claim/claim-engine';
import { buildClaimChanges } from '../lib/xls/claim-mapping';
import type { TemplateManifest } from '../lib/xls/template-manifest';

const today = { today: '2026-09-09' };

for (const template of ['general', 'student'] as const) {
  test(`${template}: receipt labels and pending attachment count do not block an otherwise complete claim`, () => {
    const draft = createSampleDraft();
    draft.template = template;
    const before = calculateClaim(draft, today);
    draft.receiptCount = '  ';
    draft.expenses.forEach((expense) => {
      expense.receipt = '';
    });
    const result = calculateClaim(draft, today);
    assert.equal(result.canExport, true);
    assert.equal(result.receiptCount, null);
    assert.equal(result.totalTwd, before.totalTwd);
    assert.equal(result.claimTwd, before.claimTwd);
    assert.ok(result.groups.every((group) => group.receipts === ''));
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../public/templates/${template}-4.json`, import.meta.url),
        'utf8',
      ),
    ) as TemplateManifest;
    const cells = buildClaimChanges(draft, result, manifest)[
      manifest.sheetName
    ];
    const period = cells[manifest.fields.period as string];
    assert.equal(typeof period, 'object');
    assert.ok(
      period &&
        typeof period === 'object' &&
        period.text.includes('附單據__張'),
    );
    for (const segment of manifest.segments)
      assert.equal(cells[segment.fields.receipt], null);
  });
}

test('existing receipt labels remain optional and do not determine the attachment count', () => {
  const draft = createSampleDraft();
  draft.receiptCount = '';
  const before = calculateClaim(draft, today);
  assert.equal(before.canExport, true);
  assert.ok(before.groups.some((group) => group.receipts));
  draft.receiptCount = '12';
  draft.expenses.forEach((expense) => {
    expense.receipt = '';
  });
  const result = calculateClaim(draft, today);
  assert.equal(result.canExport, true);
  assert.equal(result.receiptCount, 12);
  assert.equal(result.totalTwd, before.totalTwd);
});

test('attachment count rejects malformed or unsafe numbers instead of rounding or exporting infinity', () => {
  const draft = createSampleDraft();
  for (const count of [
    '-1',
    '1.5',
    '1e2',
    'abc',
    '9007199254740992',
    '9'.repeat(400),
  ]) {
    draft.receiptCount = count;
    const result = calculateClaim(draft, today);
    assert.equal(result.canExport, false, count);
    assert.equal(result.receiptCount, null, count);
    assert.ok(
      result.issues.some((issue) => issue.code === 'receipt-count'),
      count,
    );
  }
});

test('zero attachments still conflicts with claimed documented expenses even if their labels are empty', () => {
  const draft = createSampleDraft();
  draft.receiptCount = '0';
  draft.expenses.forEach((expense) => {
    expense.receipt = '';
  });
  const result = calculateClaim(draft, today);
  assert.equal(result.canExport, false);
  assert.ok(result.issues.some((issue) => issue.code === 'receipt-count-zero'));
  draft.expenses = [];
  assert.equal(calculateClaim(draft, today).receiptCount, 0);
  assert.ok(
    !calculateClaim(draft, today).issues.some((issue) =>
      issue.code.startsWith('receipt-count'),
    ),
  );
});
