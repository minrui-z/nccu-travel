import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateClaim,
  createSampleDraft,
  makeDays,
  splitGroup,
} from '../lib/claim/claim-engine';
import {
  preserveDateGroups,
  replaceGroupedDays,
  updateGroupDays,
} from '../lib/trip-groups';
import { editTransitEndpoint } from '../lib/trip-locations';

test('editing either date in a merged column updates all fields together without changing membership', () => {
  const original = createSampleDraft();
  const snapshot = structuredClone(original);
  const changed = updateGroupDays(original, original.days[3].id, (day) => ({
    ...day,
    work: '參訪校園\n研究交流',
    location: '日本・東京',
    usdRate: '300.25',
    lodgingProvided: true,
    breakfast: true,
    lunch: false,
    dinner: true,
    mealsInFlight: false,
    extraDeductionUsd: '1.25',
  }));
  assert.equal(changed.groups, original.groups);
  assert.equal(changed.groups.length, 4);
  assert.deepEqual(original, snapshot);
  for (const index of [2, 3]) {
    assert.equal(changed.days[index].date, original.days[index].date);
    assert.equal(changed.days[index].id, original.days[index].id);
    assert.equal(changed.days[index].work, '參訪校園\n研究交流');
    assert.equal(changed.days[index].usdRate, '300.25');
    assert.equal(changed.days[index].breakfast, true);
    assert.equal(changed.days[index].lunch, false);
    assert.equal(changed.days[index].dinner, true);
    assert.equal(changed.days[index].lodgingProvided, true);
    assert.equal(changed.days[index].extraDeductionUsd, '1.25');
  }
  assert.equal(changed.days[0], original.days[0]);
  assert.equal(changed.days[1], original.days[1]);
  assert.equal(changed.days[4], original.days[4]);
  const result = calculateClaim(changed);
  assert.equal(result.daily[2].netUsd, '52.795');
  assert.equal(result.daily[3].netUsd, '52.795');
  assert.equal(result.groups[2].netUsd, '105.59');
  const split = {
    ...changed,
    groups: splitGroup(changed.groups, changed.groups[2].id),
  };
  assert.equal(calculateClaim(split).totalTwd, result.totalTwd);
});

test('changing a merged status and route edits every member while preserving individual IDs and dates', () => {
  const original = createSampleDraft();
  const changed = updateGroupDays(original, original.days[2].id, (day) =>
    editTransitEndpoint(
      editTransitEndpoint(
        { ...day, kind: 'flight', lunch: false },
        'from',
        '臺北',
      ),
      'to',
      '美國波士頓',
      'boston',
    ),
  );
  for (const index of [2, 3]) {
    assert.equal(changed.days[index].kind, 'flight');
    assert.equal(changed.days[index].location, '臺北→美國波士頓');
    assert.equal(changed.days[index].transit?.toId, 'boston');
  }
  const before = structuredClone(changed);
  const edited = updateGroupDays(changed, changed.days[3].id, (day) => {
    day.transit!.to = '日本東京';
    day.location = '臺北→日本東京';
    return day;
  });
  assert.deepEqual(changed, before);
  assert.equal(edited.days[2].transit?.to, '日本東京');
  assert.equal(edited.days[3].transit?.to, '日本東京');
  assert.equal(edited.groups, original.groups);
});

test('date-specific rate changes reject a merged edit transactionally and instruct an explicit split', () => {
  const original = createSampleDraft();
  const snapshot = structuredClone(original);
  assert.throws(
    () =>
      updateGroupDays(original, original.days[2].id, (day) => ({
        ...day,
        usdRate: day.date === original.days[2].date ? '395' : '300',
      })),
    /7\/15～7\/16.*日支額不同.*先拆開此欄/,
  );
  assert.deepEqual(original, snapshot);
  const separated = {
    ...original,
    groups: splitGroup(original.groups, original.groups[2].id),
  };
  const changed = updateGroupDays(separated, separated.days[2].id, (day) => ({
    ...day,
    usdRate: '395',
  }));
  assert.equal(changed.days[2].usdRate, '395');
  assert.equal(changed.days[3].usdRate, '268');
});

test('bulk edits reject inconsistent groups without changing any column or partially applying values', () => {
  const original = createSampleDraft();
  const snapshot = structuredClone(original);
  assert.throws(
    () =>
      replaceGroupedDays(
        original,
        original.days.map((day, index) => ({
          ...day,
          work: index === 3 ? '參訪' : '出席會議',
        })),
      ),
    /先拆開此欄/,
  );
  assert.deepEqual(original, snapshot);
  const changed = replaceGroupedDays(
    original,
    original.days.map((day) => ({ ...day, work: '出席會議' })),
  );
  assert.equal(changed.groups, original.groups);
  assert.equal(
    changed.days.every((day) => day.work === '出席會議'),
    true,
  );
});

test('field editing protects day identity, dates, order and draft metadata', () => {
  const original = {
    ...createSampleDraft(),
    localMetadata: { status: 'saved' },
  };
  for (const field of ['id', 'date'] as const) {
    assert.throws(
      () =>
        updateGroupDays(original, original.days[2].id, (day) => ({
          ...day,
          [field]: 'changed',
        })),
      /不能變更日期/,
    );
  }
  assert.throws(
    () => replaceGroupedDays(original, original.days.slice().reverse()),
    /不能變更日期/,
  );
  assert.throws(
    () => replaceGroupedDays(original, original.days.slice(1)),
    /不能變更日期/,
  );
  assert.throws(
    () => updateGroupDays(original, 'missing', (day) => day),
    /找不到選取的日期/,
  );
  const changed = updateGroupDays(original, original.days[2].id, (day) => ({
    ...day,
    work: '交流',
  }));
  assert.equal(changed.localMetadata, original.localMetadata);
});

test('date-range refresh retains merged groups and creates only singleton columns for new dates', () => {
  const original = createSampleDraft();
  const fresh = makeDays('2026-07-12', '2026-07-18');
  const next = fresh.map(
    (day) => original.days.find((old) => old.date === day.date) ?? day,
  );
  const groups = preserveDateGroups(original, next);
  assert.equal(groups.length, 6);
  assert.equal(groups[3], original.groups[2]);
  assert.deepEqual(groups[0].dayIds, [next[0].id]);
  assert.deepEqual(groups.at(-1)?.dayIds, [next.at(-1)!.id]);
  assert.deepEqual(
    preserveDateGroups(original, original.days),
    original.groups,
  );
  const clipped = preserveDateGroups(original, original.days.slice(3));
  assert.equal(clipped[0].id, original.groups[2].id);
  assert.deepEqual(clipped[0].dayIds, [original.days[3].id]);
});

test('surviving memberships follow calendar dates even when a range generator creates new IDs', () => {
  const original = createSampleDraft();
  const changed = original.days.map((day) => ({
    ...day,
    id: `next-${day.id}`,
  }));
  const groups = preserveDateGroups(original, changed);
  assert.equal(groups[2].id, original.groups[2].id);
  assert.deepEqual(
    groups[2].dayIds,
    changed.slice(2, 4).map((day) => day.id),
  );
});

test('range refresh cannot silently split or preserve an incompatible retained column', () => {
  const original = createSampleDraft();
  const changed = original.days.map((day, index) =>
    index === 3 ? { ...day, kind: 'return' as const } : day,
  );
  assert.throws(() => preserveDateGroups(original, changed), /先拆開此欄/);
  const empty = { days: [], groups: [] };
  assert.deepEqual(
    preserveDateGroups(empty, original.days).map(
      (group) => group.dayIds.length,
    ),
    [1, 1, 1, 1, 1],
  );
});
