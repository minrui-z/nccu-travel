import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleDraft } from '../lib/claim/claim-engine';
import type { FxSnapshot } from '../lib/public-data';
import { updateExpense } from '../lib/expense-state';
import {
  applyExpenseFxResult,
  automaticExpenseFxRequest,
  loadExpenseFxQuote,
  prepareAutomaticExpenseDates,
} from '../lib/expense-auto-fx';

const snapshot: FxSnapshot = {
  schemaVersion: 1,
  quotationDate: '2026-08-28',
  sourceUrl: 'https://rate.bot.com.tw/xrt/flcsv/0/2026-08-28',
  retrievedAt: '2026-09-09T12:00:00Z',
  currencyRates: {
    USD: { cashSelling: '31.88500', spotSelling: '31.66500' },
    ZAR: { cashSelling: null, spotSelling: '1.80610' },
  },
};
function fixture() {
  const draft = createSampleDraft();
  draft.approvedStart = '2026-08-31';
  draft.expenses = [
    {
      ...draft.expenses[0],
      currency: 'USD',
      payment: 'cash',
      fxSource: 'bot-cash',
      fxDate: '2026-04-05',
      fxRate: '99',
      fxProofNote: '舊的報價',
    },
  ];
  return draft;
}

test('bank FX ignores an old per-expense date and derives Friday from Monday departure', async () => {
  const draft = prepareAutomaticExpenseDates(fixture());
  const expense = draft.expenses[0];
  assert.equal(expense.fxDate, '2026-08-28');
  assert.equal(expense.fxRate, '');
  assert.equal(expense.fxProofNote, '');
  const request = automaticExpenseFxRequest(expense, draft)!;
  const calls: string[] = [];
  const quote = await loadExpenseFxQuote(request, async (date) => {
    calls.push(date);
    return snapshot;
  });
  assert.deepEqual(calls, ['2026-08-28']);
  const applied = applyExpenseFxResult(draft, request, quote);
  assert.equal(applied.expenses[0].fxRate, '31.88500');
  assert.equal(applied.expenses[0].fxProofNote, snapshot.sourceUrl);
});

test('missing weekday data is never treated as a bank holiday or replaced by an older quote', async () => {
  const draft = fixture();
  draft.approvedStart = '2026-09-01';
  const request = automaticExpenseFxRequest(draft.expenses[0], draft)!;
  const calls: string[] = [];
  await assert.rejects(
    loadExpenseFxQuote(request, async (date) => {
      calls.push(date);
      throw new Error('missing');
    }),
    /2026-08-31/,
  );
  assert.deepEqual(calls, ['2026-08-31']);
  await assert.rejects(
    loadExpenseFxQuote(request, async () => snapshot),
    /日期不符/,
  );
});

test('cash quotes take precedence; spot is used only when cash is unavailable', async () => {
  const draft = fixture();
  const expense = draft.expenses[0];
  const cash = automaticExpenseFxRequest(expense, draft)!;
  assert.equal(
    (await loadExpenseFxQuote(cash, async () => snapshot)).fxSource,
    'bot-cash',
  );
  const unavailable = automaticExpenseFxRequest(
    { ...expense, currency: 'ZAR' },
    draft,
  )!;
  const fallback = await loadExpenseFxQuote(unavailable, async () => snapshot);
  assert.equal(fallback.fxSource, 'bot-spot');
  assert.equal(fallback.cashUnavailable, true);
  assert.match(fallback.fxProofNote!, /無現金賣出/);
  const spot = automaticExpenseFxRequest(
    { ...expense, fxSource: 'bot-spot' },
    draft,
  )!;
  await assert.rejects(
    loadExpenseFxQuote(spot, async () => snapshot),
    /提供.*現金賣出/,
  );
});

test('manual sources, receipts, central-bank evidence, card settlement and TWD are preserved', () => {
  const draft = fixture();
  for (const update of [
    { fxSource: 'manual' as const },
    { fxSource: 'receipt' as const },
    { fxSource: 'central-bank' as const },
    { payment: 'card' as const },
    { currency: 'TWD' },
  ]) {
    const expense = { ...draft.expenses[0], ...update };
    assert.equal(automaticExpenseFxRequest(expense, draft), null);
    const original = { ...draft, expenses: [expense] };
    assert.equal(prepareAutomaticExpenseDates(original), original);
  }
});

test('late quotes cannot overwrite a changed currency, source, departure date or removed expense', async () => {
  const draft = prepareAutomaticExpenseDates(fixture());
  const request = automaticExpenseFxRequest(draft.expenses[0], draft)!;
  const result = await loadExpenseFxQuote(request, async () => snapshot);
  for (const changed of [
    { ...draft, approvedStart: '2026-09-01' },
    { ...draft, expenses: [] },
    { ...draft, expenses: [{ ...draft.expenses[0], currency: 'EUR' }] },
    {
      ...draft,
      expenses: [
        { ...draft.expenses[0], fxSource: 'manual' as const, fxRate: '32' },
      ],
    },
  ])
    assert.equal(applyExpenseFxResult(changed, request, result), changed);
  const edited = {
    ...draft,
    purpose: '查詢時新輸入的會議名稱',
    expenses: [{ ...draft.expenses[0], amount: '100', description: '新說明' }],
  };
  const applied = applyExpenseFxResult(edited, request, result);
  assert.equal(applied.purpose, edited.purpose);
  assert.equal(applied.expenses[0].amount, '100');
  assert.equal(applied.expenses[0].description, '新說明');
});

test('concurrent expense quotes preserve one another and non-FX edits', async () => {
  let draft = prepareAutomaticExpenseDates(fixture());
  draft = {
    ...draft,
    expenses: [
      ...draft.expenses,
      { ...draft.expenses[0], id: 'second', currency: 'ZAR' },
    ],
  };
  const requests = draft.expenses.map((expense) =>
    automaticExpenseFxRequest(expense, draft)!,
  );
  const quotes = await Promise.all(
    requests.map((request) =>
      loadExpenseFxQuote(request, async () => snapshot),
    ),
  );
  const first = applyExpenseFxResult(draft, requests[0], quotes[0]);
  const second = applyExpenseFxResult(first, requests[1], quotes[1]);
  assert.equal(second.expenses[0].fxRate, '31.88500');
  assert.equal(second.expenses[1].fxRate, '1.80610');
});

test('missing or malformed rates cannot become zero or a fabricated cash quote', async () => {
  const draft = fixture();
  const request = automaticExpenseFxRequest(draft.expenses[0], draft)!;
  for (const cashSelling of [null, '0', '-1', 'Infinity', '1,000']) {
    await assert.rejects(
      loadExpenseFxQuote(request, async () => ({
        ...snapshot,
        currencyRates: { USD: { cashSelling, spotSelling: null } },
      })),
      /未提供.*有效賣出/,
    );
  }
});

test('an invalid departure clears an old automatic quote and cannot trigger a lookup', () => {
  const input = fixture();
  input.approvedStart = '';
  input.startDate = '';
  const draft = prepareAutomaticExpenseDates(input);
  assert.equal(draft.expenses[0].fxRate, '');
  assert.equal(draft.expenses[0].fxDate, '');
  assert.equal(automaticExpenseFxRequest(draft.expenses[0], draft), null);
});

test('editing or clearing a bank quote date survives automatic preparation', () => {
  const original = prepareAutomaticExpenseDates(fixture());
  for (const fxDate of ['2026-08-27', '']) {
    const expense = updateExpense(original.expenses[0], { fxDate });
    assert.equal(expense.fxProvenance, 'manual');
    assert.equal(expense.fxRate, '');
    assert.equal(expense.fxProofNote, '');
    const draft = { ...original, expenses: [expense] };
    assert.equal(prepareAutomaticExpenseDates(draft), draft);
  }
});

test('explicit bank refresh uses and retains the selected date after a successful lookup', async () => {
  const original = prepareAutomaticExpenseDates(fixture());
  const draft = {
    ...original,
    expenses: [{ ...original.expenses[0], fxDate: '2026-08-27', fxProvenance: 'manual' as const }],
  };
  const request = automaticExpenseFxRequest(draft.expenses[0], draft)!;
  const calls: string[] = [];
  const quote = await loadExpenseFxQuote(request, async date => {
    calls.push(date);
    return { ...snapshot, quotationDate: '2026-08-27' };
  });
  assert.deepEqual(calls, ['2026-08-27']);
  const applied = applyExpenseFxResult(draft, request, quote);
  assert.equal(applied.expenses[0].fxDate, '2026-08-27');
  assert.equal(applied.expenses[0].fxRate, '31.88500');
  assert.equal(prepareAutomaticExpenseDates(applied), applied);
});

test('a response for the old date cannot overwrite a newly selected date', async () => {
  const draft = prepareAutomaticExpenseDates(fixture());
  const request = automaticExpenseFxRequest(draft.expenses[0], draft)!;
  const result = await loadExpenseFxQuote(request, async () => snapshot);
  const edited = { ...draft, expenses: [updateExpense(draft.expenses[0], { fxDate: '2026-08-27' })] };
  assert.equal(applyExpenseFxResult(edited, request, result), edited);
});
