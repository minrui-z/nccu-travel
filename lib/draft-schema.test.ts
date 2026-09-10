import test from 'node:test';
import assert from 'node:assert/strict';
import { isDraft } from './draft-schema';
import { createEmptyDraft, createSampleDraft } from './claim/claim-engine';

const clone = (): Record<string, any> => structuredClone(createSampleDraft());
test('empty and sample drafts are accepted, including blank amounts and explicit zero', () => {
  assert.equal(isDraft(createEmptyDraft()), true);
  assert.equal(isDraft(createSampleDraft()), true);
  const value = clone();
  value.fundingLimit = '0';
  value.expenses[0].amount = '';
  value.days[0].usdRate = '0';
  assert.equal(isDraft(value), true);
});
test('all required daily booleans reject truthy strings, numeric flags, missing fields and objects', () => {
  for (const key of [
    'lodgingProvided',
    'breakfast',
    'lunch',
    'dinner',
    'mealsInFlight',
    'weekendOfficial',
  ]) {
    for (const bad of ['false', 'true', 0, 1, {}, [], null, undefined]) {
      const value = clone();
      value.days[0][key] = bad;
      assert.equal(isDraft(value), false, `${key}=${JSON.stringify(bad)}`);
    }
  }
});
test('expense, cabin, insurance and funding booleans require actual booleans', () => {
  const targets: Array<[string, string]> = [
    ['cabin', 'standard'],
    ['cabin', 'seniorEligible'],
    ['insurance', 'capConfirmed'],
    ...[
      'priorApproval',
      'approvedItems',
      'shared',
      'sharingApproved',
      'planChanged',
      'changeApproved',
    ].map((key) => ['funding', key] as [string, string]),
  ];
  for (const [container, key] of targets) {
    for (const bad of ['false', 0, {}, undefined]) {
      const value = clone();
      value[container][key] = bad;
      assert.equal(isDraft(value), false, `${container}.${key}`);
    }
  }
  const value = clone();
  value.expenses[0].foreignTaxi = 'false';
  assert.equal(isDraft(value), false);
});
test('required enums reject unknown strings and values of another type', () => {
  const mutate = [
    (v: Record<string, any>) => {
      v.template = 'other';
    },
    (v: Record<string, any>) => {
      v.days[0].kind = 'INVALID';
    },
    (v: Record<string, any>) => {
      v.expenses[0].category = 'living';
    },
    (v: Record<string, any>) => {
      v.expenses[0].payment = 'bank';
    },
    (v: Record<string, any>) => {
      v.fx.source = 'bot-cash';
    },
    (v: Record<string, any>) => {
      v.funding.type = 'research';
    },
    (v: Record<string, any>) => {
      v.funding.activityRole = true;
    },
  ];
  for (const change of mutate) {
    const value = clone();
    change(value);
    assert.equal(isDraft(value), false);
  }
});
test('optional values may be omitted or undefined without rejecting an otherwise valid old draft', () => {
  const value = clone();
  for (const key of [
    'approvedEnd',
    'dischargeDate',
    'funding',
    'destinationIds',
    'checkedDocuments',
    'insuranceSelection',
    'foreignAirline',
    'economyClaimOnly',
    'airfareExplanation',
  ])
    delete value[key];
  delete value.fx.manualBasis;
  for (const expense of value.expenses)
    for (const key of ['fxDate', 'fxSource', 'fxProofNote', 'manualBasis'])
      delete expense[key];
  assert.equal(isDraft(value), true);
  value.approvedEnd = undefined;
  value.checkedDocuments = undefined;
  value.foreignAirline = undefined;
  assert.equal(isDraft(value), true);
});
test('optional booleans and text fields reject null and wrong types', () => {
  for (const key of ['foreignAirline', 'economyClaimOnly']) {
    for (const good of [true, false, undefined]) {
      const value = clone();
      value[key] = good;
      assert.equal(isDraft(value), true);
    }
    for (const bad of ['false', 0, null, {}]) {
      const value = clone();
      value[key] = bad;
      assert.equal(isDraft(value), false, key);
    }
  }
  for (const key of ['approvedEnd', 'dischargeDate', 'airfareExplanation']) {
    const value = clone();
    value[key] = null;
    assert.equal(isDraft(value), false, key);
  }
  for (const key of ['fxDate', 'fxProofNote']) {
    const value = clone();
    value.expenses[0][key] = 0;
    assert.equal(isDraft(value), false, key);
  }
});
test('optional FX enum fields validate every supported value and reject arbitrary sources', () => {
  for (const source of [
    'bot-cash',
    'bot-spot',
    'receipt',
    'card',
    'central-bank',
    'manual',
    undefined,
  ]) {
    const value = clone();
    value.expenses[0].fxSource = source;
    assert.equal(isDraft(value), true);
  }
  for (const basis of ['bank', 'receipt', undefined]) {
    const value = clone();
    value.fx.manualBasis = basis;
    value.expenses[0].manualBasis = basis;
    assert.equal(isDraft(value), true);
  }
  for (const bad of ['other', '', null, true]) {
    const value = clone();
    value.fx.manualBasis = bad;
    assert.equal(isDraft(value), false);
    const expenseValue = clone();
    expenseValue.expenses[0].manualBasis = bad;
    assert.equal(isDraft(expenseValue), false);
    const sourceValue = clone();
    sourceValue.expenses[0].fxSource = bad;
    assert.equal(isDraft(sourceValue), false);
  }
});
test('optional administrative type accepts registration and other only', () => {
  for (const good of ['registration', 'other', undefined]) {
    const value = clone();
    value.expenses[0].administrativeType = good;
    assert.equal(isDraft(value), true);
  }
  for (const bad of ['insurance', '', null, false]) {
    const value = clone();
    value.expenses[0].administrativeType = bad;
    assert.equal(isDraft(value), false);
  }
});
test('destination and attachment maps require the correct primitive value at every key', () => {
  const good = clone();
  good.destinationIds = { day1: 'city-id', day2: '' };
  good.checkedDocuments = { receipt: false, itinerary: true };
  assert.equal(isDraft(good), true);
  for (const bad of [
    [],
    null,
    { day1: true },
    { day1: { id: 'city' } },
    { day1: undefined },
  ]) {
    const value = clone();
    value.destinationIds = bad;
    assert.equal(isDraft(value), false);
  }
  for (const bad of [
    [],
    null,
    { proof: 'false' },
    { proof: 0 },
    { proof: {} },
    { proof: undefined },
  ]) {
    const value = clone();
    value.checkedDocuments = bad;
    assert.equal(isDraft(value), false);
  }
});
test('insurance selection requires complete text fields, while no selection is allowed', () => {
  const value = clone();
  value.insuranceSelection = { contractId: '', planId: '', days: '' };
  assert.equal(isDraft(value), true);
  for (const bad of [
    null,
    [],
    {},
    { contractId: 'x', planId: 'y', days: 5 },
    { contractId: 'x', days: '5' },
  ]) {
    const candidate = clone();
    candidate.insuranceSelection = bad;
    assert.equal(isDraft(candidate), false);
  }
});
test('nested containers must be plain objects, never arrays, dates or primitive values', () => {
  for (const key of ['person', 'fx', 'cabin', 'insurance', 'funding']) {
    for (const bad of [null, [], 'data', new Date()]) {
      const value = clone();
      value[key] = bad;
      assert.equal(isDraft(value), false, key);
    }
  }
  for (const value of [null, [], 'text', false, 0, new Date()])
    assert.equal(isDraft(value), false);
});
test('every required text field retains its string type', () => {
  for (const key of [
    'purpose',
    'budgetItem',
    'voucherNumber',
    'approvedStart',
    'startDate',
    'endDate',
    'receiptCount',
    'fundingLimit',
    'notes',
  ]) {
    const value = clone();
    delete value[key];
    assert.equal(isDraft(value), false, key);
  }
  for (const [container, keys] of [
    ['person', ['name', 'identifier', 'title', 'grade']],
    ['fx', ['rate', 'rateDate', 'proofNote']],
    ['insurance', ['coverageAmount', 'premiumCap']],
  ] as const) {
    for (const key of keys) {
      const value = clone();
      value[container][key] = 0;
      assert.equal(isDraft(value), false, `${container}.${key}`);
    }
  }
});
test('array shapes and existing size limits are enforced at every level', () => {
  for (const key of ['days', 'expenses', 'groups']) {
    const value = clone();
    value[key] = {};
    assert.equal(isDraft(value), false, key);
  }
  const days = clone();
  days.days = Array(367).fill(days.days[0]);
  assert.equal(isDraft(days), false);
  const expenses = clone();
  expenses.expenses = Array(501).fill(expenses.expenses[0]);
  assert.equal(isDraft(expenses), false);
  const groups = clone();
  groups.groups = Array(367).fill(groups.groups[0]);
  assert.equal(isDraft(groups), false);
  for (const bad of [
    null,
    [],
    { id: 'group', dayIds: ['ok', false] },
    { id: 'group', dayIds: Array(367).fill('day') },
  ]) {
    const value = clone();
    value.groups = [bad];
    assert.equal(isDraft(value), false);
  }
});
test('validation does not mutate, coerce or silently fill persisted data', () => {
  const value = clone();
  const before = structuredClone(value);
  assert.equal(isDraft(value), true);
  assert.deepEqual(value, before);
  value.days[0].weekendOfficial = 'false';
  const badBefore = structuredClone(value);
  assert.equal(isDraft(value), false);
  assert.deepEqual(value, badBefore);
});
