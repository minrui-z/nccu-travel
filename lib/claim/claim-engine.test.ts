import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  autoGroupDays,
  calculateClaim,
  canGroupDays,
  civilDay,
  createEmptyDraft,
  createSampleDraft,
  fxDepartureDate,
  fxReferenceDate,
  makeDays,
  mergeGroups,
  mergeSelection,
  splitGroup,
} from './claim-engine.ts';
import type { Draft, Expense } from './types.ts';

const today = { today: '2026-09-08' };
const calc = (draft: Draft) => calculateClaim(draft, today);
const codes = (draft: Draft) => calc(draft).issues.map((issue) => issue.code);
function minimal(): Draft {
  const draft = createSampleDraft();
  draft.expenses = [];
  draft.fundingLimit = '';
  draft.receiptCount = '0';
  draft.days.forEach((day) => {
    day.usdRate = '0';
    day.extraDeductionUsd = '';
  });
  draft.groups = autoGroupDays(draft.days);
  return draft;
}
function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'test',
    date: '2026-07-13',
    category: 'handling',
    description: 'test',
    amount: '1',
    currency: 'TWD',
    fxRate: '1',
    payment: 'cash',
    cardTwd: '',
    cardFeeTwd: '',
    receipt: '1',
    foreignTaxi: false,
    ...overrides,
  };
}
test('anonymous original arithmetic: category subtotal 77759; requested amount 70000', () => {
  const result = calc(createSampleDraft());
  assert.equal(result.totalTwd, 77759);
  assert.equal(result.claimTwd, 70000);
  assert.equal(
    result.categories.find((row) => row.category === 'living')?.exactTwd,
    '27652.9904',
  );
  assert.equal(
    result.categories.find((row) => row.category === 'registration')?.exactTwd,
    '10498.25',
  );
  assert.equal(result.canExport, true);
  assert.deepEqual(
    result.issues.filter((issue) => issue.severity === 'error'),
    [],
  );
  assert.equal(result.groups[2].livingText, '268×2=536');
  assert.equal(result.groups[2].deductionText, 'US$42.88');
});
test('old sample is only a mathematical fixture and blocked under 115 rules', () => {
  const draft = createSampleDraft();
  draft.startDate = '2022-07-11';
  assert.ok(codes(draft).includes('rule-effective-date'));
  assert.equal(calc(draft).canExport, false);
});
test('same category with different FX rates is added exactly before one rounding', () => {
  const draft = minimal();
  draft.receiptCount = '2';
  draft.expenses = [
    expense({
      id: 'a',
      amount: '0.01',
      currency: 'USD',
      fxRate: '49',
      fxSource: 'manual',
      fxProofNote: 'proof',
      fxDate: '2026-07-10',
    }),
    expense({
      id: 'b',
      amount: '0.01',
      currency: 'EUR',
      fxRate: '48',
      fxSource: 'manual',
      fxProofNote: 'proof',
      fxDate: '2026-07-10',
    }),
  ];
  const result = calc(draft);
  assert.equal(result.totalTwd, 1);
  assert.equal(
    result.categories.find((row) => row.category === 'handling')?.exactTwd,
    '0.97',
  );
});
test('positive HALF_UP and 24 decimal multiplication do not use binary floats', () => {
  const draft = minimal();
  draft.receiptCount = '1';
  draft.expenses = [expense({ amount: '100.5' })];
  assert.equal(calc(draft).totalTwd, 101);
  draft.expenses = [
    expense({
      amount: '0.123456789012',
      currency: 'USD',
      fxRate: '0.123456789012',
      fxDate: '2026-07-10',
      fxSource: 'manual',
      fxProofNote: 'proof',
    }),
  ];
  assert.equal(
    calc(draft).categories.find((row) => row.category === 'handling')?.exactTwd,
    '0.015241578753153483936144',
  );
});
test('blank money is unavailable while explicit zero remains a valid zero', () => {
  const draft = minimal();
  draft.expenses = [expense({ amount: '' })];
  assert.equal(calc(draft).totalTwd, null);
  assert.ok(codes(draft).includes('missing-amount'));
  draft.expenses[0].amount = '0';
  assert.equal(calc(draft).totalTwd, 0);
});
test('negative, excessively precise, and huge values fail without throwing', () => {
  const draft = minimal();
  draft.expenses = [expense({ amount: '-1' })];
  assert.ok(codes(draft).includes('invalid-amount'));
  draft.expenses[0].amount = '0.1234567890123';
  assert.equal(calc(draft).totalTwd, null);
  draft.expenses[0] = expense({
    amount: '999999999999999',
    currency: 'USD',
    fxRate: '999999999999999',
  });
  assert.equal(calc(draft).totalTwd, null);
  assert.ok(codes(draft).includes('amount-overflow'));
});
test('return and overnight flight retain 30%, with lodging removed only once', () => {
  const draft = createSampleDraft();
  draft.days[4].lodgingProvided = true;
  const result = calc(draft);
  assert.equal(result.daily[4].netUsd, '80.4');
  assert.equal(result.daily[4].percent, 30);
  assert.equal(result.daily[0].netUsd, '80.4');
});
test('included meals remove 4/8/8%; flight meals are exempt', () => {
  const draft = createSampleDraft();
  Object.assign(draft.days[1], { breakfast: true, lunch: true, dinner: true });
  draft.groups = autoGroupDays(draft.days);
  assert.equal(calc(draft).daily[1].netUsd, '214.4');
  assert.equal(calc(draft).daily[1].deductionUsd, '53.6');
  draft.days[1].mealsInFlight = true;
  assert.equal(calc(draft).daily[1].netUsd, '268');
});
test('weekend allowance follows daily status without an application confirmation', () => {
  const draft = minimal();
  draft.startDate = draft.approvedStart = '2026-07-18';
  draft.endDate = draft.approvedEnd = '2026-07-19';
  draft.days = makeDays(draft.startDate, draft.endDate, {
    usdRate: '100',
    location: '城市',
    work: '工作',
  });
  draft.groups = autoGroupDays(draft.days);
  draft.fx.rateDate = '2026-07-17';
  assert.equal(draft.days[0].weekendOfficial, false);
  const before = calc(draft);
  assert.equal(before.daily[0].netUsd, '100');
  assert.equal(before.daily[1].netUsd, '30');
  assert.equal(before.canExport, true);
  assert.ok(!codes(draft).includes('weekend-not-official'));
  draft.days[0].weekendOfficial = true;
  assert.deepEqual(calc(draft).daily, before.daily);
});
test('legacy approval period does not exclude travel days or block export', () => {
  const draft = createSampleDraft();
  draft.approvedStart = '2026-07-14';
  draft.approvedEnd = '2026-07-16';
  assert.equal(calc(draft).daily[0].netUsd, '80.4');
  assert.equal(calc(draft).daily[4].netUsd, '80.4');
  assert.equal(calc(draft).totalTwd, 77759);
  assert.equal(calc(draft).canExport, true);
  assert.ok(!codes(draft).includes('outside-approval'));
});
test('missing or invalid legacy approval dates use actual departure for FX and do not block export', () => {
  const draft = createSampleDraft();
  for (const approvedStart of ['', 'invalid', '2026-02-30']) {
    draft.approvedStart = approvedStart;
    draft.approvedEnd = 'invalid';
    assert.equal(fxDepartureDate(draft), '2026-07-13');
    assert.equal(calc(draft).fxReferenceDate, '2026-07-10');
    assert.equal(calc(draft).canExport, true);
    assert.ok(!codes(draft).includes('approved-dates'));
  }
});
test('matching weekdays and weekends merge regardless of legacy application flags', () => {
  const days = makeDays('2026-07-17', '2026-07-19', {
    usdRate: '100', location: '城市', work: '工作', kind: 'official',
  });
  days[2].weekendOfficial = true;
  assert.equal(canGroupDays(days), true);
  assert.equal(autoGroupDays(days).length, 1);
  const singles = days.map(day => ({ id: day.id, dayIds: [day.id] }));
  assert.equal(mergeSelection(days, singles, singles.map(group => group.id)).canMerge, true);
});
test('FX reference follows approved departure, not earlier private travel', () => {
  assert.equal(fxReferenceDate('2026-07-13'), '2026-07-10');
  const draft = createSampleDraft();
  draft.startDate = '2026-07-12';
  assert.equal(fxDepartureDate(draft), '2026-07-13');
  assert.equal(calc(draft).fxReferenceDate, '2026-07-10');
});
test('FX receipt interval includes approved minus 15 days and actual return only', () => {
  const draft = createSampleDraft();
  draft.fx.source = 'receipt';
  draft.fx.proofNote = 'receipt';
  draft.fx.rateDate = '2026-06-28';
  assert.ok(!codes(draft).includes('fx-receipt-window'));
  draft.fx.rateDate = '2026-06-27';
  assert.ok(codes(draft).includes('fx-receipt-window'));
  draft.fx.rateDate = '2026-07-17';
  assert.ok(!codes(draft).includes('fx-receipt-window'));
  draft.fx.rateDate = '2026-07-18';
  assert.ok(codes(draft).includes('fx-receipt-window'));
});
test('future bank date and missing FX cannot become an apparently valid total', () => {
  const draft = createSampleDraft();
  draft.approvedStart = '2026-12-14';
  draft.fx.source = 'bot';
  draft.fx.rate = '';
  draft.fx.rateDate = '2026-12-11';
  assert.equal(calc(draft).totalTwd, null);
  assert.ok(codes(draft).includes('future-fx'));
  assert.ok(codes(draft).includes('fx-unpublished'));
});
test('foreign taxi is misc and all misc items share daily 1100 total cap', () => {
  const draft = minimal();
  draft.receiptCount = '1';
  draft.expenses = [expense({ category: 'land', foreignTaxi: true })];
  assert.ok(codes(draft).includes('taxi-category'));
  draft.expenses[0].category = 'misc';
  draft.expenses[0].amount = '5500';
  assert.ok(!codes(draft).includes('misc-cap'));
  draft.expenses.push(
    expense({ id: 'gift', category: 'misc', amount: '0.01' }),
  );
  assert.ok(codes(draft).includes('misc-cap'));
});
test('misc cap counts weekend and outside-approval days while excluding explicit private days', () => {
  const draft = minimal();
  draft.startDate = '2026-07-17';
  draft.endDate = '2026-07-19';
  draft.approvedStart = '2026-07-18';
  draft.approvedEnd = '2026-07-18';
  draft.fx.rateDate = '2026-07-17';
  draft.days = makeDays(draft.startDate, draft.endDate, {
    usdRate: '0', location: '城市', work: '工作',
  });
  draft.groups = autoGroupDays(draft.days);
  draft.receiptCount = '1';
  draft.expenses = [expense({ date: draft.startDate, category: 'misc', amount: '3300' })];
  assert.ok(!codes(draft).includes('misc-cap'));
  assert.equal(calc(draft).canExport, true);
  draft.expenses[0].amount = '3300.01';
  assert.ok(codes(draft).includes('misc-cap'));
  draft.days[1].kind = 'personal';
  draft.groups = autoGroupDays(draft.days);
  draft.expenses[0].amount = '2200';
  assert.ok(!codes(draft).includes('misc-cap'));
  draft.expenses[0].amount = '2200.01';
  assert.ok(codes(draft).includes('misc-cap'));
});
test('insurance coverage and common supply premium caps are separate', () => {
  const draft = createSampleDraft();
  draft.insurance.capConfirmed = false;
  assert.ok(codes(draft).includes('insurance-cap-unknown'));
  draft.insurance.coverageAmount = '4000001';
  assert.ok(codes(draft).includes('insurance-coverage'));
  draft.insurance.premiumCap = '607';
  assert.ok(codes(draft).includes('insurance-premium'));
});
test('card expense uses direct statement TWD plus explicit fee, ignores entered rate', () => {
  const draft = minimal();
  draft.receiptCount = '1';
  draft.expenses = [
    expense({
      payment: 'card',
      amount: '',
      fxRate: '',
      cardTwd: '1000.25',
      cardFeeTwd: '20.25',
    }),
  ];
  assert.equal(calc(draft).totalTwd, 1021);
  assert.equal(calc(draft).expenses[0].exactTwd, '1020.5');
  assert.ok(codes(draft).includes('card-fee-proof'));
});
test('civil dates remain stable across DST, year and leap boundaries', () => {
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(civilDay('2026-02-29'), null);
  assert.deepEqual(
    makeDays('2026-10-31', '2026-11-02').map((day) => day.date),
    ['2026-10-31', '2026-11-01', '2026-11-02'],
  );
  const draft = createSampleDraft();
  draft.days[1].date = 'invalid';
  assert.doesNotThrow(() => calc(draft));
  assert.ok(codes(draft).includes('day-sequence'));
});
test('merge permits only consecutive compatible days; split restores individual dates', () => {
  const days = makeDays('2026-09-01', '2026-09-03', {
    kind: 'official',
    usdRate: '100',
    location: '城市',
    work: '工作',
  });
  const singles = days.map((day) => ({
    id: `group-${day.id}`,
    dayIds: [day.id],
  }));
  const merged = mergeGroups(
    days,
    singles,
    singles.map((group) => group.id),
  );
  assert.equal(merged.length, 1);
  assert.equal(splitGroup(merged, merged[0].id).length, 3);
  days[1].lunch = true;
  assert.equal(canGroupDays(days), false);
  assert.throws(() =>
    mergeGroups(
      days,
      singles,
      singles.map((group) => group.id),
    ),
  );
});
test('missing or overlapping groups and unreadable column count block export', () => {
  const draft = createSampleDraft();
  draft.groups = [draft.groups[0]];
  assert.ok(codes(draft).includes('groups-coverage'));
  draft.groups = Array.from({ length: 13 }, (_, i) => ({
    id: String(i),
    dayIds: [draft.days[0].id],
  }));
  assert.ok(codes(draft).includes('print-columns'));
});
test('merge selection explains missing, incompatible and nonadjacent selections without mutating groups', () => {
  const draft = createSampleDraft();
  const before = JSON.stringify(draft.groups);
  assert.equal(mergeSelection(draft.days, draft.groups, []).canMerge, false);
  assert.equal(
    mergeSelection(draft.days, draft.groups, [draft.groups[0].id]).count,
    1,
  );
  const mismatch = mergeSelection(
    draft.days,
    draft.groups,
    draft.groups.slice(1, 3).map((g) => g.id),
  );
  assert.equal(mismatch.canMerge, false);
  assert.match(mismatch.reason, /工作記要|早餐|午餐|晚餐/);
  assert.equal(
    mergeSelection(draft.days, draft.groups, [
      draft.groups[0].id,
      draft.groups[2].id,
    ]).canMerge,
    false,
  );
  assert.equal(JSON.stringify(draft.groups), before);
  const empty = [
    { id: 'a', dayIds: [] },
    { id: 'b', dayIds: [] },
  ];
  assert.equal(mergeSelection([], empty, ['a', 'b']).canMerge, false);
});
test('split then select compatible dates restores the original total and date coverage', () => {
  const draft = createSampleDraft();
  const initial = calc(draft);
  const group = draft.groups.find((g) => g.dayIds.length > 1)!;
  draft.groups = splitGroup(draft.groups, group.id);
  const selected = draft.groups
    .filter((g) => g.dayIds.some((id) => group.dayIds.includes(id)))
    .map((g) => g.id);
  const result = mergeSelection(draft.days, draft.groups, selected);
  assert.equal(result.canMerge, true);
  assert.match(result.reason, /可合併為 1 欄/);
  draft.groups = result.groups;
  assert.deepEqual(
    draft.groups.flatMap((g) => g.dayIds),
    draft.days.map((d) => d.id),
  );
  assert.equal(calc(draft).totalTwd, initial.totalTwd);
  assert.equal(calc(draft).totalTwd, 77759);
});
test('both forms accept up to twelve distinct date columns, with content capacity checked separately', () => {
  const draft = minimal();
  draft.days = makeDays('2026-09-01', '2026-09-12', {
    location: '城市',
    work: '公差',
    usdRate: '100',
    weekendOfficial: true,
  });
  draft.groups = draft.days.map((d) => ({ id: d.id, dayIds: [d.id] }));
  for (const kind of ['general', 'student'] as const) {
    draft.template = kind;
    assert.ok(!codes(draft).includes('print-columns'));
  }
});
test('zero meal deduction does not mislabel flight meals as no free meals', () => {
  const draft = minimal();
  draft.days.forEach((d) => {
    d.mealsInFlight = true;
    d.lunch = true;
  });
  draft.groups = autoGroupDays(draft.days);
  const result = calc(draft);
  assert.ok(result.groups.every((g) => g.deductionText === '航程供餐不扣'));
  draft.days.forEach((d) => {
    d.mealsInFlight = false;
  });
  draft.groups = autoGroupDays(draft.days);
  assert.ok(calc(draft).groups.every((g) => g.deductionText === 'US$0'));
});
test('funding, receipt count, and administrative approval checks are meaningful', () => {
  const draft = createSampleDraft();
  draft.receiptCount = '0';
  assert.ok(codes(draft).includes('receipt-count-zero'));
  draft.funding!.priorApproval = false;
  assert.ok(codes(draft).includes('registration-approval'));
  draft.funding!.type = 'nstc';
  draft.funding!.activityRole = 'other';
  assert.ok(codes(draft).includes('nstc-role'));
  draft.funding!.shared = true;
  assert.ok(codes(draft).includes('sharing-approval'));
  draft.funding!.planChanged = true;
  assert.ok(codes(draft).includes('plan-change'));
});
test('empty drafts are valid editable state but never export-ready', () => {
  assert.doesNotThrow(() => calc(createEmptyDraft()));
  assert.equal(calc(createEmptyDraft()).canExport, false);
});

test('actual final day cannot be exported at ordinary full allowance after shortening trip', () => {
  const draft = createSampleDraft();
  draft.days.at(-1)!.kind = 'official';
  draft.groups = autoGroupDays(draft.days);
  assert.ok(codes(draft).includes('return-kind'));
  assert.equal(calc(draft).canExport, false);
  draft.days.at(-1)!.kind = 'return';
  draft.groups = autoGroupDays(draft.days);
  assert.ok(!codes(draft).includes('return-kind'));
  assert.equal(calc(draft).canExport, true);
  draft.days.at(-1)!.kind = 'flight';
  draft.groups = autoGroupDays(draft.days);
  assert.ok(!codes(draft).includes('return-kind'));
  assert.equal(calc(draft).daily.at(-1)!.percent, 30);
  draft.days.at(-1)!.kind = 'personal';
  draft.groups = autoGroupDays(draft.days);
  assert.ok(!codes(draft).includes('return-kind'));
  assert.equal(calc(draft).daily.at(-1)!.netUsd, '0');
});
test('private-day expenses block export and are never silently removed from preview', () => {
  const draft = minimal();
  draft.days[1].kind = 'personal';
  draft.groups = autoGroupDays(draft.days);
  draft.expenses = [
    expense({
      date: draft.days[1].date,
      category: 'misc',
      amount: '1000',
      foreignTaxi: true,
    }),
  ];
  draft.receiptCount = '1';
  assert.equal(calc(draft).totalTwd, 1000);
  assert.equal(calc(draft).canExport, false);
  assert.ok(codes(draft).includes('expense-ineligible-day'));
  draft.expenses[0].date = draft.days[0].date;
  assert.ok(!codes(draft).includes('expense-ineligible-day'));
});
test('expenses outside legacy approval dates or on weekends remain eligible', () => {
  const draft = minimal();
  draft.approvedStart = draft.days[1].date;
  draft.groups = autoGroupDays(draft.days);
  draft.expenses = [expense({ amount: '100' })];
  draft.receiptCount = '1';
  assert.ok(!codes(draft).includes('expense-ineligible-day'));
  assert.equal(calc(draft).canExport, true);
  const weekend = minimal();
  weekend.startDate = weekend.approvedStart = '2026-07-18';
  weekend.endDate = weekend.approvedEnd = '2026-07-19';
  weekend.days = makeDays(weekend.startDate, weekend.endDate, {
    usdRate: '0',
    location: '城市',
    work: '公務',
  });
  weekend.groups = autoGroupDays(weekend.days);
  weekend.fx.rateDate = '2026-07-17';
  weekend.expenses = [expense({ date: weekend.startDate })];
  weekend.receiptCount = '1';
  assert.ok(!codes(weekend).includes('expense-ineligible-day'));
  assert.equal(calc(weekend).canExport, true);
  weekend.days[0].weekendOfficial = true;
  assert.ok(!codes(weekend).includes('expense-ineligible-day'));
});
test('earlier bank dates require holiday evidence for both living and expense FX', () => {
  const draft = minimal();
  draft.fx.source = 'bot';
  draft.fx.rateDate = '2026-01-05';
  draft.fx.proofNote = '';
  assert.ok(codes(draft).includes('fx-holiday-proof-required'));
  assert.equal(calc(draft).canExport, false);
  draft.fx.proofNote = '逐日官方未報價證明';
  assert.ok(!codes(draft).includes('fx-holiday-proof-required'));
  assert.ok(codes(draft).includes('fx-holiday-proof'));
  draft.fx.rateDate = '2026-07-10';
  draft.expenses = [
    expense({
      currency: 'USD',
      fxRate: '30',
      fxDate: '2026-01-05',
      fxSource: 'bot-cash',
      fxProofNote: '',
    }),
  ];
  draft.receiptCount = '1';
  assert.ok(codes(draft).includes('fx-holiday-proof-required'));
});
test('manual bank FX keeps baseline restrictions and cannot bypass an unpublished reference', () => {
  const draft = createSampleDraft();
  draft.fx.source = 'manual';
  draft.fx.manualBasis = 'bank';
  draft.fx.rateDate = '2026-07-13';
  assert.ok(codes(draft).includes('fx-reference'));
  draft.approvedStart = draft.startDate = '2026-12-14';
  draft.approvedEnd = draft.endDate = '2026-12-15';
  draft.days = makeDays(draft.startDate, draft.endDate, {
    usdRate: '100',
    location: '城市',
    work: '公務',
  });
  draft.expenses = [];
  draft.receiptCount = '0';
  draft.groups = [];
  draft.fx.rateDate = '2026-07-10';
  assert.ok(codes(draft).includes('fx-unpublished'));
  assert.equal(calc(draft).canExport, false);
});
test('manual receipt FX applies inclusive minus15-to-return window, also for expenses', () => {
  const draft = minimal();
  draft.fx.manualBasis = 'receipt';
  draft.fx.rateDate = '2026-06-28';
  assert.ok(!codes(draft).includes('fx-receipt-window'));
  assert.ok(!codes(draft).includes('fx-reference'));
  draft.fx.rateDate = '2026-06-27';
  assert.ok(codes(draft).includes('fx-receipt-window'));
  draft.fx.rateDate = '2026-07-17';
  assert.ok(!codes(draft).includes('fx-receipt-window'));
  draft.expenses = [
    expense({
      currency: 'USD',
      fxRate: '30',
      fxDate: '2026-06-27',
      fxSource: 'manual',
      manualBasis: 'receipt',
      fxProofNote: '結匯水單',
    }),
  ];
  draft.receiptCount = '1';
  assert.ok(codes(draft).includes('fx-receipt-window'));
  draft.expenses[0].fxDate = '2026-06-28';
  assert.ok(!codes(draft).includes('fx-receipt-window'));
});
test('self-funded cabin upgrade requires economy-only claim, explanation and documented fare', () => {
  const draft = createSampleDraft();
  draft.cabin.standard = false;
  draft.cabin.seniorEligible = false;
  const authorize = () => {
    draft.economyClaimOnly = true;
    draft.airfareExplanation = '自費升等，僅申請經濟艙票價';
    draft.checkedDocuments = { 'economy-proof': true };
  };
  authorize();
  assert.equal(calc(draft).canExport, true);
  assert.ok(codes(draft).includes('cabin-economy-only'));
  assert.equal(draft.cabin.standard, false);
  draft.economyClaimOnly = false;
  assert.ok(codes(draft).includes('cabin'));
  authorize();
  draft.airfareExplanation = ' ';
  assert.ok(codes(draft).includes('cabin'));
  authorize();
  draft.checkedDocuments!['economy-proof'] = false;
  assert.ok(codes(draft).includes('cabin'));
});

test('NSTC exemption applies to conference registration only, not other administrative fees', () => {
  const d = createSampleDraft();
  d.funding!.type = 'nstc';
  d.funding!.priorApproval = false;
  assert.equal(
    calculateClaim(d).issues.some((i) => i.code === 'registration-approval'),
    false,
  );
  d.expenses.find((e) => e.category === 'registration')!.administrativeType =
    'other';
  assert.equal(
    calculateClaim(d).issues.some((i) => i.code === 'registration-approval'),
    true,
  );
});

test('foreign spot and central bank paths require applicable fallback evidence', () => {
  const d = createSampleDraft(),
    e = d.expenses.find((e) => e.category === 'registration')!;
  e.fxSource = 'bot-spot';
  assert.ok(calculateClaim(d).issues.some((i) => i.code === 'spot-condition'));
  e.cashUnavailable = true;
  assert.ok(!calculateClaim(d).issues.some((i) => i.code === 'spot-condition'));
  e.fxSource = 'central-bank';
  assert.ok(
    calculateClaim(d).issues.some((i) => i.code === 'central-bank-condition'),
  );
  e.botUnavailable = true;
  assert.ok(
    !calculateClaim(d).issues.some((i) => i.code === 'central-bank-condition'),
  );
  e.fxSource = 'card';
  assert.ok(
    calculateClaim(d).issues.some((i) => i.code === 'cash-card-source'),
  );
});
test('manually changed daily allowance requires recorded source', () => {
  const d = createSampleDraft();
  d.days[1].rateSource = 'manual';
  assert.ok(
    calculateClaim(d).issues.some((i) => i.path === 'days.1.usdRateProof'),
  );
  d.days[1].usdRateProof = '官方日支額表頁碼與城市依據';
  assert.ok(
    !calculateClaim(d).issues.some((i) => i.path === 'days.1.usdRateProof'),
  );
});
