import type { WorkbenchDraft } from '../app/model';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
const strings = (value: RecordValue, keys: readonly string[]) =>
  keys.every(
    (key) => Object.hasOwn(value, key) && typeof value[key] === 'string',
  );
const booleans = (value: RecordValue, keys: readonly string[]) =>
  keys.every(
    (key) => Object.hasOwn(value, key) && typeof value[key] === 'boolean',
  );
const oneOf = (value: unknown, choices: readonly string[]) =>
  typeof value === 'string' && choices.includes(value);
const optionalString = (value: unknown) =>
  value === undefined || typeof value === 'string';
const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === 'boolean';
const optionalEnum = (value: unknown, choices: readonly string[]) =>
  value === undefined || oneOf(value, choices);
const optionalMap = (value: unknown, type: 'string' | 'boolean') =>
  value === undefined ||
  (record(value) && Object.values(value).every((item) => typeof item === type));
const manualBases = ['bank', 'receipt'] as const;
const fxProvenances = ['automatic', 'manual', 'imported'] as const;
const expenseFxSources = [
  'bot-cash',
  'bot-spot',
  'receipt',
  'card',
  'central-bank',
  'manual',
] as const;

function daily(value: unknown): boolean {
  return (
    record(value) &&
    strings(value, [
      'id',
      'date',
      'location',
      'work',
      'usdRate',
      'extraDeductionUsd',
    ]) &&
    oneOf(value.kind, ['official', 'return', 'flight', 'personal']) &&
    optionalEnum(value.rateSource, ['official', 'manual']) &&
    optionalString(value.usdRateProof) &&
    (value.transit === undefined ||
      (record(value.transit) &&
        strings(value.transit, ['from', 'to']) &&
        optionalString(value.transit.fromId) &&
        optionalString(value.transit.toId))) &&
    booleans(value, [
      'lodgingProvided',
      'breakfast',
      'lunch',
      'dinner',
      'mealsInFlight',
      'weekendOfficial',
    ])
  );
}
function expense(value: unknown): boolean {
  return (
    record(value) &&
    strings(value, [
      'id',
      'date',
      'description',
      'amount',
      'currency',
      'fxRate',
      'cardTwd',
      'cardFeeTwd',
      'receipt',
    ]) &&
    oneOf(value.category, [
      'flight',
      'ship',
      'land',
      'handling',
      'insurance',
      'registration',
      'misc',
    ]) &&
    oneOf(value.payment, ['cash', 'card']) &&
    booleans(value, ['foreignTaxi']) &&
    optionalString(value.fxDate) &&
    optionalString(value.fxProofNote) &&
    optionalEnum(value.fxProvenance, fxProvenances) &&
    optionalEnum(value.fxSource, expenseFxSources) &&
    optionalEnum(value.manualBasis, manualBases) &&
    optionalEnum(value.administrativeType, ['registration', 'other']) &&
    optionalBoolean(value.cashUnavailable) &&
    optionalBoolean(value.botUnavailable)
  );
}
function group(value: unknown): boolean {
  return (
    record(value) &&
    strings(value, ['id']) &&
    Array.isArray(value.dayIds) &&
    value.dayIds.length <= 366 &&
    value.dayIds.every((id) => typeof id === 'string')
  );
}
function funding(value: unknown): boolean {
  return (
    value === undefined ||
    (record(value) &&
      oneOf(value.type, ['nstc', 'other']) &&
      oneOf(value.activityRole, [
        'paper',
        'speaker',
        'chair',
        'approved',
        'other',
      ]) &&
      booleans(value, [
        'priorApproval',
        'approvedItems',
        'shared',
        'sharingApproved',
        'planChanged',
        'changeApproved',
      ]))
  );
}

/** Validate storage shape only; incomplete dates, empty monetary fields and explicit zero remain editable. */
export function isDraft(value: unknown): value is WorkbenchDraft {
  if (
    !record(value) ||
    value.version !== 1 ||
    !oneOf(value.template, ['general', 'student'])
  )
    return false;
  if (
    !strings(value, [
      'purpose',
      'budgetItem',
      'voucherNumber',
      'approvedStart',
      'startDate',
      'endDate',
      'receiptCount',
      'fundingLimit',
      'notes',
    ])
  )
    return false;
  if (
    !optionalString(value.approvedEnd) ||
    !optionalString(value.dischargeDate) ||
    !optionalString(value.airfareExplanation)
  )
    return false;
  if (
    !record(value.person) ||
    !strings(value.person, ['name', 'identifier', 'title', 'grade'])
  )
    return false;
  if (
    !record(value.fx) ||
    !strings(value.fx, ['rate', 'rateDate', 'proofNote']) ||
    !oneOf(value.fx.source, ['bot', 'receipt', 'card', 'manual']) ||
    !optionalEnum(value.fx.manualBasis, manualBases) ||
    !optionalEnum(value.fx.provenance, fxProvenances)
  )
    return false;
  if (
    !record(value.insurance) ||
    !strings(value.insurance, ['coverageAmount', 'premiumCap']) ||
    !booleans(value.insurance, ['capConfirmed'])
  )
    return false;
  if (
    !record(value.cabin) ||
    !booleans(value.cabin, ['standard', 'seniorEligible'])
  )
    return false;
  if (
    !Array.isArray(value.days) ||
    value.days.length > 366 ||
    !value.days.every(daily)
  )
    return false;
  if (
    !Array.isArray(value.expenses) ||
    value.expenses.length > 500 ||
    !value.expenses.every(expense)
  )
    return false;
  if (
    !Array.isArray(value.groups) ||
    value.groups.length > 366 ||
    !value.groups.every(group)
  )
    return false;
  if (!funding(value.funding)) return false;
  if (
    !optionalBoolean(value.foreignAirline) ||
    !optionalBoolean(value.economyClaimOnly)
  )
    return false;
  if (
    !optionalMap(value.destinationIds, 'string') ||
    !optionalMap(value.checkedDocuments, 'boolean')
  )
    return false;
  if (
    value.insuranceSelection !== undefined &&
    (!record(value.insuranceSelection) ||
      !strings(value.insuranceSelection, ['contractId', 'planId', 'days']))
  )
    return false;
  return true;
}
