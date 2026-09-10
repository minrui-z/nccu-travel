import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoGroupDays,
  calculateClaim,
  canGroupDays,
  createSampleDraft,
} from '../lib/claim/claim-engine';
import { updateGroupDays } from '../lib/trip-groups';
import {
  applyDailyDestination,
  changeDayKind,
  normalizePrivateDays,
} from '../lib/trip-locations';
import type { Allowances } from '../lib/public-data';
import { normalizeDraftTransition } from '../lib/draft-transitions';

test('switching a merged column to private keeps its location and identifies personal travel while clearing claim fields', () => {
  const source = createSampleDraft();
  const draft = {
    ...source,
    destinationIds: Object.fromEntries(
      source.days.map((day) => [day.id, 'old-city']),
    ),
  };
  const group = draft.groups.find((entry) => entry.dayIds.length > 1)!;
  const result = normalizePrivateDays(
    updateGroupDays(draft, group.dayIds[0], (day) =>
      changeDayKind(day, 'personal'),
    ),
  );
  assert.equal(result.groups, draft.groups);
  assert.equal(result.expenses, draft.expenses);
  assert.equal(result.fx, draft.fx);
  for (const day of result.days.filter((day) =>
    group.dayIds.includes(day.id),
  )) {
    assert.equal(day.kind, 'personal');
    assert.equal(
      day.location,
      draft.days.find((entry) => entry.id === day.id)!.location,
    );
    assert.equal(day.work, '個人行程');
    for (const key of ['usdRate', 'extraDeductionUsd'] as const)
      assert.equal(day[key], '');
    for (const key of [
      'lodgingProvided',
      'breakfast',
      'lunch',
      'dinner',
      'mealsInFlight',
    ] as const)
      assert.equal(day[key], false);
    assert.equal(day.transit, undefined);
    assert.equal(day.usdRateProof, undefined);
    assert.equal(result.destinationIds?.[day.id], undefined);
  }
  assert.equal(draft.days[2].usdRate, '268');
  assert.equal(result.days[0], draft.days[0]);
});
test('private location survives restoration, and changing back clears the personal label and old claim fields', () => {
  const draft = createSampleDraft();
  draft.days[0] = {
    ...draft.days[0],
    kind: 'personal',
    transit: { from: '臺北', to: '東京' },
    usdRateProof: 'old proof',
  };
  const restored = normalizePrivateDays({
    ...draft,
    destinationIds: { [draft.days[0].id]: 'old-city' },
  });
  assert.equal(restored.days[0].location, draft.days[0].location);
  assert.equal(restored.days[0].work, '個人行程');
  assert.equal(restored.days[0].transit, undefined);
  assert.equal(restored.destinationIds?.[draft.days[0].id], undefined);
  const official = changeDayKind(restored.days[0], 'official');
  assert.equal(official.usdRate, '');
  assert.equal(official.location, restored.days[0].location);
  assert.equal(official.work, '');
});
test('allowance lookup never populates a private day, even with a selected city or unavailable data', () => {
  const day = { ...createSampleDraft().days[1], kind: 'personal' as const };
  const result = applyDailyDestination(
    day,
    { destinations: [] } as unknown as Allowances,
    'stale-selection',
  );
  assert.equal(result.usdRate, '');
  assert.equal(result.location, day.location);
  assert.equal(result.work, '個人行程');
});

test('editing an optional private location updates every merged date and persists without a split', () => {
  const draft = createSampleDraft();
  const group = draft.groups.find((entry) => entry.dayIds.length > 1)!;
  const personal = normalizePrivateDays(
    updateGroupDays(draft, group.dayIds[0], (day) =>
      changeDayKind(day, 'personal'),
    ),
  );
  const updated = normalizeDraftTransition(
    personal,
    updateGroupDays(personal, group.dayIds[0], (day) => ({
      ...day,
      location: '美國・西雅圖',
    })),
  );
  const restored = normalizePrivateDays(
    JSON.parse(JSON.stringify(updated)) as typeof updated,
  );
  assert.equal(updated.groups, draft.groups);
  for (const day of restored.days.filter((entry) =>
    group.dayIds.includes(entry.id),
  )) {
    assert.equal(day.location, '美國・西雅圖');
    assert.equal(day.work, '個人行程');
    assert.equal(day.usdRate, '');
  }
  const result = calculateClaim(restored, { today: '2026-09-09' });
  const calculated = result.groups.find((entry) => entry.id === group.id)!;
  assert.equal(calculated.location, '美國・西雅圖');
  assert.equal(calculated.work, '個人行程');
  assert.equal(calculated.livingText, '');
  assert.equal(calculated.deductionText, '');
});

test('changing private travel to an overnight or return route requires fresh route and allowance details', () => {
  const personal = changeDayKind(
    { ...createSampleDraft().days[0], location: '美國・西雅圖' },
    'personal',
  );
  for (const kind of ['flight', 'return'] as const) {
    const changed = changeDayKind(personal, kind);
    assert.equal(changed.work, '');
    assert.equal(changed.usdRate, '');
    assert.equal(changed.rateSource, undefined);
    assert.deepEqual(changed.transit, { from: '', to: '' });
    assert.ok(!changed.location.includes('西雅圖'));
  }
});

test('private locations are optional but different places cannot be silently merged', () => {
  const draft = createSampleDraft();
  draft.expenses = [];
  draft.days = draft.days.map((day) =>
    changeDayKind({ ...day, location: '' }, 'personal'),
  );
  draft.groups = autoGroupDays(draft.days);
  const result = calculateClaim(draft, { today: '2026-09-09' });
  assert.equal(result.canExport, true);
  assert.equal(result.groups[0].location, '');
  assert.equal(result.groups[0].work, '個人行程');
  assert.equal(canGroupDays(draft.days), true);
  draft.days[0].location = '美國・西雅圖';
  assert.equal(canGroupDays(draft.days), false);
  assert.ok(
    calculateClaim(draft, { today: '2026-09-09' }).issues.some(
      (issue) => issue.code === 'group-incompatible',
    ),
  );
});
