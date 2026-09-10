import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleDraft, calculateClaim } from '../lib/claim/claim-engine';
import {
  updateExpense,
  expenseFxContext,
  updateLivingFx,
} from '../lib/expense-state';

test('currency change cannot relabel an old USD rate as EUR, TWD or custom currency', () => {
  const draft = createSampleDraft();
  const expense = draft.expenses.find((e) => e.currency === 'USD')!;
  for (const currency of ['EUR', 'TWD', 'ABC']) {
    const changed = updateExpense(
      {
        ...expense,
        cashUnavailable: true,
        botUnavailable: true,
        cardTwd: '800',
        cardFeeTwd: '12',
      },
      { currency },
    );
    assert.equal(changed.fxRate, '');
    assert.equal(changed.fxProofNote, '');
    assert.equal(changed.fxDate, '');
    assert.equal(changed.cardTwd, '');
    assert.equal(changed.cardFeeTwd, '');
    assert.equal(changed.cashUnavailable, false);
    assert.equal(changed.botUnavailable, false);
    if (currency !== 'TWD') {
      draft.expenses = [changed];
      assert.equal(calculateClaim(draft).canExport, false);
    }
  }
});

test('changing date or source invalidates the previous quote, but applying an entire quote keeps it', () => {
  const expense = createSampleDraft().expenses.find(
    (e) => e.currency === 'USD',
  )!;
  for (const update of [
    { fxDate: '2026-07-09' },
    { fxSource: 'receipt' as const },
    { manualBasis: 'receipt' as const },
  ]) {
    const changed = updateExpense(expense, update);
    assert.equal(changed.fxRate, '');
    assert.equal(changed.fxProofNote, '');
    assert.notEqual(expenseFxContext(changed), expenseFxContext(expense));
  }
  const quote = {
    fxRate: '31.2',
    fxDate: '2026-07-10',
    fxSource: 'bot-cash' as const,
    fxProofNote: '官方網址',
  };
  assert.equal(updateExpense(expense, quote).fxRate, '31.2');
});

test('switching payment clears inactive settlement values and changing category clears its hidden flags', () => {
  const expense = {
    ...createSampleDraft().expenses[0],
    payment: 'card' as const,
    cardTwd: '39000',
    cardFeeTwd: '100',
    foreignTaxi: true,
  };
  const cash = updateExpense(expense, { payment: 'cash' });
  const card = updateExpense(cash, { payment: 'card' });
  assert.equal(card.cardTwd, '');
  assert.equal(card.cardFeeTwd, '');
  assert.equal(card.amount, expense.amount);
  assert.equal(
    updateExpense(expense, { category: 'registration' }).foreignTaxi,
    false,
  );
  assert.equal(
    updateExpense(expense, { category: 'misc', foreignTaxi: true }).foreignTaxi,
    true,
  );
});

test('living FX cannot carry an old quote into a new date or proof basis', () => {
  const fx = createSampleDraft().fx;
  for (const update of [
    { rateDate: '2026-07-09' },
    { source: 'receipt' as const },
    { manualBasis: 'receipt' as const },
  ]) {
    const changed = updateLivingFx(fx, update);
    assert.equal(changed.rate, '');
    assert.equal(changed.proofNote, '');
  }
  assert.equal(
    updateLivingFx(fx, { rate: '31.2', rateDate: '2026-07-09' }).rate,
    '31.2',
  );
});
