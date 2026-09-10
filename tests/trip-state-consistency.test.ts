import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateClaim, createSampleDraft, makeDays } from '../lib/claim/claim-engine';
import {
  applyDailyDestination,
  changeDayKind,
  copyDutyDestination,
  editTransitEndpoint,
  setProvidedMeal,
} from '../lib/trip-locations';
import { updateGroupDays } from '../lib/trip-groups';
import type { Allowances } from '../lib/public-data';

const data = JSON.parse(
  readFileSync(new URL('../public/data/allowances-2026.json', import.meta.url), 'utf8'),
) as Allowances;

test('changing from a route to an ordinary duty day removes hidden endpoints and legacy in-flight meals', () => {
  const source = {
    ...createSampleDraft().days[0],
    transit: { from: '臺北', to: '美國波士頓', toId: 'boston' },
    location: '臺北→美國波士頓',
    breakfast: true,
    lunch: true,
    dinner: false,
    mealsInFlight: true,
  };
  const snapshot = structuredClone(source);
  const ordinary = changeDayKind(source, 'official');
  assert.equal(ordinary.transit, undefined);
  assert.equal(ordinary.location, '');
  assert.equal(ordinary.mealsInFlight, false);
  assert.equal(ordinary.breakfast, false);
  assert.equal(ordinary.lunch, false);
  assert.equal(ordinary.dinner, false);
  assert.equal(ordinary.usdRate, source.usdRate);
  assert.deepEqual(source, snapshot);
  const routeAgain = changeDayKind(ordinary, 'flight');
  assert.deepEqual(routeAgain.transit, { from: '', to: '' });
  assert.equal(routeAgain.location, '→');
});

test('transit and return status remove the inapplicable supplied-lodging flag while retaining actual conference meals', () => {
  const source = { ...createSampleDraft().days[1], lodgingProvided: true, lunch: true, mealsInFlight: false };
  for (const kind of ['flight', 'return'] as const) {
    const result = changeDayKind(source, kind);
    assert.equal(result.lodgingProvided, false);
    assert.equal(result.lunch, true);
    assert.equal(result.usdRate, source.usdRate);
  }
  const route = editTransitEndpoint(editTransitEndpoint(changeDayKind(source, 'flight'), 'from', '東京'), 'to', '臺北');
  const returned = changeDayKind(route, 'return');
  assert.deepEqual(returned.transit, route.transit);
  assert.equal(returned.location, '東京→臺北');
});

test('editing a provided meal replaces the legacy flight-meal selection without charging unrelated flight meals', () => {
  const original = { ...createSampleDraft().days[1], breakfast: false, lunch: true, dinner: true, mealsInFlight: true };
  const edited = setProvidedMeal(original, 'breakfast', true);
  assert.equal(edited.breakfast, true);
  assert.equal(edited.lunch, false);
  assert.equal(edited.dinner, false);
  assert.equal(edited.mealsInFlight, false);
  assert.equal(original.mealsInFlight, true);
  const draft = createSampleDraft();
  draft.days[1] = edited;
  assert.equal(calculateClaim(draft).daily[1].deductionUsd, '10.72');
  assert.equal(calculateClaim(draft).daily[1].netUsd, '257.28');
  const another = setProvidedMeal(edited, 'lunch', true);
  assert.equal(another.breakfast, true);
  assert.equal(another.lunch, true);
  assert.equal(setProvidedMeal(another, 'breakfast', false).lunch, true);
  const privateDay = setProvidedMeal({ ...original, kind: 'personal' }, 'breakfast', true);
  assert.equal(privateDay.breakfast, false);
  assert.equal(privateDay.usdRate, '');
});

test('selecting an ordinary destination removes stale hidden route metadata', () => {
  const source = { ...createSampleDraft().days[1], transit: { from: '臺北', to: '倫敦' } };
  const selected = applyDailyDestination(source, data, 'foreign-070');
  assert.equal(selected.transit, undefined);
  assert.equal(applyDailyDestination(source, data, '').transit, undefined);
});

test('bulk official allowance lookup never substitutes the source date rate when public data is unavailable', () => {
  const days = makeDays('2026-08-31', '2026-09-01', { kind: 'official', work: '研究交流' });
  const source = applyDailyDestination(days[0], data, 'foreign-070');
  const target = days[1];
  assert.equal(source.usdRate, '227');
  assert.throws(() => copyDutyDestination(source, target, null, 'foreign-070'), /日支額資料.*載入/);
  const copied = copyDutyDestination(source, target, data, 'foreign-070');
  assert.equal(copied.usdRate, '259');
  assert.equal(copied.work, '研究交流');
  assert.equal(target.usdRate, '');
  const manual = { ...source, rateSource: 'manual' as const, usdRate: '220', usdRateProof: '官方核定資料' };
  assert.equal(copyDutyDestination(manual, target, null, '').usdRate, '220');
});

test('season changes do not silently split merged dates or partially apply a destination', () => {
  const days = makeDays('2026-08-31', '2026-09-01', { kind: 'official', location: '待填', work: '研究交流', usdRate: '300' });
  const draft = { days, groups: [{ id: 'merged', dayIds: days.map((day) => day.id) }] };
  const snapshot = structuredClone(draft);
  assert.throws(() => updateGroupDays(draft, days[0].id, (day) => applyDailyDestination(day, data, 'foreign-070')), /日支額不同.*先拆開/);
  assert.deepEqual(draft, snapshot);
});
