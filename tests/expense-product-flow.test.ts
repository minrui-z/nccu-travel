import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateClaim,
  createEmptyDraft,
  createSampleDraft,
} from '../lib/claim/claim-engine';
import { isDraft } from '../lib/draft-schema';
import {
  normalizeFxProvenance,
  isProtectedExpenseQuote,
} from '../lib/fx-provenance';
import { FxInputError, fxImportError, fxLookupError } from '../lib/fx-errors';
import {
  prepareAutomaticExpenseDates,
  automaticExpenseFxRequest,
  applyExpenseFxResult,
} from '../lib/expense-auto-fx';
import { updateExpense, updateLivingFx } from '../lib/expense-state';
import {
  expenseIssues,
  expenseFxComplete,
  requestedExpenseId,
  formatExpenseAmount,
} from '../lib/expense-view';

test('legacy FX evidence migrates once without changing amounts, dates or user-entered proof', () => {
  const draft = createSampleDraft();
  draft.fx.proofNote = '官方 CSV：生活費.csv；報價日期已核對';
  draft.expenses[2].fxProofNote = '自行核對的銀行報價';
  const original = structuredClone(draft);
  const next = normalizeFxProvenance(draft);
  assert.equal(next.fx.provenance, 'imported');
  assert.equal(next.expenses[2].fxProvenance, 'manual');
  assert.equal(next.fx.rate, draft.fx.rate);
  assert.equal(next.fx.proofNote, draft.fx.proofNote);
  assert.equal(next.expenses[2].fxDate, draft.expenses[2].fxDate);
  assert.deepEqual(draft, original);
  assert.deepEqual(normalizeFxProvenance(next), next);
  assert.equal(
    normalizeFxProvenance(createEmptyDraft()).fx.provenance,
    undefined,
  );
});

test('explicit provenance survives rewritten display copy and is validated in restored drafts', () => {
  const draft = createSampleDraft();
  for (const provenance of ['automatic', 'manual', 'imported'] as const) {
    draft.fx.provenance = provenance;
    draft.expenses[2].fxProvenance = provenance;
    draft.expenses[2].fxProofNote = '已重新命名的使用者說明';
    assert.equal(isDraft(draft), true);
    const next = normalizeFxProvenance(draft);
    assert.equal(next.fx.provenance, provenance);
    assert.equal(next.expenses[2].fxProvenance, provenance);
    assert.equal(
      isProtectedExpenseQuote(next.expenses[2]),
      provenance !== 'automatic',
    );
  }
  assert.equal(
    isDraft({ ...draft, fx: { ...draft.fx, provenance: 'unsupported' } }),
    false,
  );
  assert.equal(
    isDraft({
      ...draft,
      expenses: [{ ...draft.expenses[2], fxProvenance: false }],
    }),
    false,
  );
});

test('imported and manually owned bank quotes retain their dates during automatic preparation', () => {
  const draft = createSampleDraft();
  for (const provenance of ['manual', 'imported'] as const) {
    draft.expenses = [
      {
        ...draft.expenses[2],
        fxSource: 'bot-cash',
        fxProvenance: provenance,
        fxDate: '2026-07-09',
      },
    ];
    assert.equal(prepareAutomaticExpenseDates(draft), draft);
    const cleared = updateExpense(draft.expenses[0], { currency: 'EUR' });
    assert.equal(cleared.fxProvenance, undefined);
    assert.equal(cleared.fxRate, '');
    assert.equal(isProtectedExpenseQuote(cleared), false);
    draft.expenses = createSampleDraft().expenses;
  }
});

test('quote edits take ownership and stale async results cannot overwrite an imported quote', () => {
  const draft = createSampleDraft();
  draft.expenses = [
    { ...draft.expenses[2], fxSource: 'bot-cash', fxProvenance: 'automatic' },
  ];
  const original = draft.expenses[0];
  assert.equal(
    updateExpense(original, { fxRate: '31.001' }).fxProvenance,
    'manual',
  );
  const clearedByUser = updateExpense(original, { fxRate: '' });
  assert.equal(isProtectedExpenseQuote(clearedByUser), true);
  const userDraft = { ...draft, expenses: [clearedByUser] };
  assert.equal(prepareAutomaticExpenseDates(userDraft), userDraft);
  assert.equal(
    updateLivingFx({ ...draft.fx, provenance: 'automatic' }, { rate: '31.002' })
      .provenance,
    'manual',
  );
  assert.equal(
    updateLivingFx(
      { ...draft.fx, provenance: 'automatic' },
      { rateDate: '2026-07-09' },
    ).provenance,
    undefined,
  );
  const request = automaticExpenseFxRequest(original, draft)!;
  const edited = {
    ...draft,
    expenses: [{ ...original, fxProvenance: 'imported' as const }],
  };
  assert.equal(
    applyExpenseFxResult(edited, request, {
      fxRate: '99',
      fxProvenance: 'automatic',
    }),
    edited,
  );
});

test('CSV parser and transport diagnostics become actionable user messages without leaking raw details', () => {
  for (const diagnostic of [
    'OFFICIAL_SOURCE_BLOCKED: response is HTML or a validation page',
    'Unknown BOT currency header',
    'Unclosed CSV quote',
    'TypeError: Failed to fetch private-internal-endpoint',
  ]) {
    const result = fxImportError(new Error(diagnostic));
    assert.match(result, /臺灣銀行|匯率檔/);
    assert.ok(!result.includes(diagnostic));
    assert.doesNotMatch(
      result,
      /TypeError|OFFICIAL_SOURCE_BLOCKED|Unknown BOT|Unclosed/,
    );
  }
  assert.match(
    fxImportError(
      new Error(
        'QUOTATION_DATE_MISMATCH: requested 2026-07-10, received 2026-07-09.',
      ),
    ),
    /2026-07-09.*2026-07-10/,
  );
  assert.equal(
    fxImportError(new FxInputError('日期已更改，請重新匯入。')),
    '日期已更改，請重新匯入。',
  );
  assert.match(fxLookupError(new Error('fetch /data/fx/secret.json')), /重試/);
  assert.ok(
    !fxLookupError(new Error('fetch /data/fx/secret.json')).includes('secret'),
  );
});

test('expense completion excludes optional receipt numbering while retaining relevant financial errors', () => {
  const draft = createSampleDraft();
  draft.expenses = draft.expenses.map((expense) => ({
    ...expense,
    receipt: '',
  }));
  const calculation = calculateClaim(draft, { today: '2026-09-09' });
  assert.deepEqual(expenseIssues(draft.expenses[2], 2, calculation.issues), []);
  draft.expenses[2].fxRate = '';
  const incomplete = calculateClaim(draft, { today: '2026-09-09' });
  assert.equal(expenseFxComplete(draft.expenses[2], 2, incomplete), false);
  assert.ok(
    expenseIssues(draft.expenses[2], 2, incomplete.issues).some(
      (issue) => issue.path === 'expenses.2.fxRate',
    ),
  );
  assert.deepEqual(expenseIssues(draft.expenses[0], 0, incomplete.issues), []);
});

test('error destinations open the correct collapsed expense and its shared settings', () => {
  const draft = createSampleDraft();
  assert.equal(
    requestedExpenseId(draft, 'expenses.2.fxRate'),
    draft.expenses[2].id,
  );
  assert.equal(requestedExpenseId(draft, 'insurance'), draft.expenses[1].id);
  assert.equal(
    requestedExpenseId(draft, 'insuranceSelection.days'),
    draft.expenses[1].id,
  );
  assert.equal(
    requestedExpenseId(draft, 'cabin.standard'),
    draft.expenses[0].id,
  );
  assert.equal(
    requestedExpenseId(draft, 'funding.priorApproval'),
    draft.expenses[2].id,
  );
  assert.equal(requestedExpenseId(draft, 'expenses.999.fxRate'), undefined);
  assert.equal(requestedExpenseId(draft, 'person.name'), undefined);
});

test('expense summaries distinguish explicit zero from missing amounts without display rounding', () => {
  assert.equal(formatExpenseAmount('0'), '0');
  assert.equal(formatExpenseAmount(null), '金額待填');
  assert.equal(formatExpenseAmount('11184.25001'), '11,184.25001');
});
