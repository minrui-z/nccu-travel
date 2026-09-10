import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateClaim, createSampleDraft } from '../lib/claim/claim-engine';
import type { Expense } from '../lib/claim/types';

const today = { today: '2026-09-09' };
const makeExpense = (patch: Partial<Expense> = {}): Expense => ({
  id: 'expense-eligibility', date: '2026-07-13', category: 'handling',
  description: '費用測試', amount: '100', currency: 'TWD', fxRate: '',
  payment: 'cash', cardTwd: '', cardFeeTwd: '', receipt: '1',
  foreignTaxi: false,
  ...patch,
});

test('deleting the last flight makes old cabin choices inactive; adding it back restores validation', () => {
  const draft = createSampleDraft();
  const flight = draft.expenses.find((expense) => expense.category === 'flight')!;
  draft.cabin.standard = false;
  draft.expenses = draft.expenses.filter((expense) => expense.category !== 'flight');
  const result = calculateClaim(draft, today);
  assert.equal(result.totalTwd, 38759);
  assert.equal(result.canExport, true);
  assert.ok(!result.issues.some((issue) => issue.path === 'cabin'));
  draft.expenses.push(flight);
  const restored = calculateClaim(draft, today);
  assert.equal(restored.canExport, false);
  assert.ok(restored.issues.some((issue) => issue.code === 'cabin'));
});

test('NSTC participation approval does not leak into other funding after switching funding type', () => {
  const draft = createSampleDraft();
  draft.expenses = draft.expenses.filter((expense) => expense.category !== 'registration');
  draft.funding = {
    ...draft.funding!, type: 'other', activityRole: 'approved',
    priorApproval: false, approvedItems: true,
  };
  const result = calculateClaim(draft, today);
  assert.equal(result.totalTwd, 67261);
  assert.equal(result.canExport, true);
  assert.ok(!result.issues.some((issue) => issue.code === 'activity-approval'));
  draft.funding.type = 'nstc';
  const restored = calculateClaim(draft, today);
  assert.equal(restored.canExport, false);
  assert.ok(restored.issues.some((issue) => issue.code === 'activity-approval'));
});

test('an expense without its own FX date cannot silently borrow the living allowance date', () => {
  const draft = createSampleDraft();
  draft.expenses = [makeExpense({
    currency: 'USD', fxRate: '31', fxDate: undefined,
    fxSource: 'manual', fxProofNote: '臺銀官方指定日期報價',
  })];
  const result = calculateClaim(draft, today);
  assert.equal(draft.fx.rateDate, '2026-07-10');
  assert.equal(result.canExport, false);
  assert.ok(result.issues.some((issue) => issue.path === 'expenses.0.fxDate'));
  draft.expenses[0].fxDate = '2026-07-10';
  assert.equal(calculateClaim(draft, today).canExport, true);
});

test('credit card and TWD payment ignore fields belonging to their inactive conversion mode', () => {
  const draft = createSampleDraft();
  draft.expenses = [makeExpense({
    payment: 'card', currency: '', amount: 'invalid', cardTwd: '100', cardFeeTwd: '1',
    fxRate: '-1', fxDate: '2099-01-01', fxSource: 'bot-spot',
    cashUnavailable: false, fxProofNote: '',
  })];
  let result = calculateClaim(draft, today);
  assert.equal(result.canExport, true);
  assert.equal(result.expenses[0].exactTwd, '101');
  assert.equal(result.totalTwd, 27754);
  draft.expenses[0] = makeExpense({
    currency: 'NTD', amount: '99', cardTwd: 'invalid', cardFeeTwd: '-1',
    fxRate: 'invalid', fxDate: '2099-01-01', fxSource: 'bot-spot',
    cashUnavailable: false, fxProofNote: '',
  });
  result = calculateClaim(draft, today);
  assert.equal(result.canExport, true);
  assert.equal(result.expenses[0].exactTwd, '99');
  assert.equal(result.totalTwd, 27752);
});
