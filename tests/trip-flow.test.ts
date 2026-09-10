import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleDraft,
  mergeGroups,
  splitGroup,
} from '../lib/claim/claim-engine';
import {
  prepareTripDates,
  restoreTripGroups,
  livingFxCanAutoFill,
  describeTripDates,
  tripFormError,
} from '../lib/trip-flow';

test('date-change confirmation groups consecutive affected dates across month boundaries', () => {
  assert.equal(
    describeTripDates(['2026-07-31', '2026-08-01', '2026-08-04']),
    '2026-07-31～2026-08-01、2026-08-04',
  );
});

test('date range preparation is atomic and preserves remaining daily edits and every expense', () => {
  const draft = createSampleDraft();
  const before = JSON.stringify(draft);
  const prepared = prepareTripDates(draft, {
    start: '2026-07-14',
    end: '2026-07-16',
  });
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(
    prepared.removed.map((day) => day.date),
    ['2026-07-13', '2026-07-17'],
  );
  assert.equal(prepared.draft.startDate, '2026-07-14');
  assert.equal(prepared.draft.endDate, '2026-07-16');
  assert.equal(prepared.draft.days[1], draft.days[2]);
  assert.equal(prepared.draft.expenses, draft.expenses);
  assert.ok(prepared.affectedExpenses.length > 0);
  assert.deepEqual(
    prepared.draft.groups.at(-1)?.dayIds,
    draft.groups[2].dayIds,
  );
});

test('invalid date edits change nothing, and extension preserves existing columns', () => {
  const draft = createSampleDraft();
  assert.throws(() =>
    prepareTripDates(draft, { start: '2026-07-18', end: '2026-07-13' }),
  );
  const next = prepareTripDates(draft, {
    start: '2026-07-13',
    end: '2026-07-19',
  });
  assert.equal(next.removed.length, 0);
  assert.equal(next.draft.days.length, 7);
  assert.equal(next.draft.groups[2], draft.groups[2]);
  assert.equal(next.draft.groups.at(-1)?.dayIds.length, 1);
});

test('ordinary FX departure follows an applied range but a separately entered baseline survives', () => {
  const draft = createSampleDraft();
  assert.equal(
    prepareTripDates(draft, { start: '2026-07-12', end: draft.endDate }).draft
      .approvedStart,
    '2026-07-12',
  );
  draft.approvedStart = '2026-07-14';
  assert.equal(
    prepareTripDates(draft, { start: '2026-07-12', end: draft.endDate }).draft
      .approvedStart,
    '2026-07-14',
  );
});

test('merge undo restores only columns and keeps later expense and day edits', () => {
  const original = createSampleDraft();
  const draft = {
    ...original,
    groups: splitGroup(original.groups, original.groups[2].id),
  };
  const selected = draft.groups
    .filter((group) =>
      group.dayIds.some((id) => original.groups[2].dayIds.includes(id)),
    )
    .map((group) => group.id);
  const merged = {
    ...draft,
    groups: mergeGroups(draft.days, draft.groups, selected),
    notes: '保留稍後的備註',
  };
  const restored = restoreTripGroups(merged, draft.groups);
  assert.equal(restored.groups, draft.groups);
  assert.equal(restored.notes, merged.notes);
  assert.equal(restored.days, merged.days);
  assert.equal(restored.expenses, merged.expenses);
  assert.throws(() =>
    restoreTripGroups({ ...merged, days: merged.days.slice(1) }, draft.groups),
  );
  const separatelyEdited = {
    ...draft,
    days: draft.days.map((day, index) =>
      index === 2 ? { ...day, work: '另一項工作' } : day,
    ),
  };
  assert.throws(
    () => restoreTripGroups(separatelyEdited, original.groups),
    /日期內容已分別修改/,
  );
});

test('living bank auto-fill never replaces manual, imported or independently dated evidence', () => {
  const draft = createSampleDraft();
  assert.equal(livingFxCanAutoFill(draft), false);
  draft.fx = { source: 'bot', rate: '', rateDate: '', proofNote: '' };
  assert.equal(livingFxCanAutoFill(draft), true);
  for (const source of ['receipt', 'manual'] as const)
    assert.equal(
      livingFxCanAutoFill({ ...draft, fx: { ...draft.fx, source } }),
      false,
    );
  for (const field of ['rate', 'rateDate', 'proofNote'] as const)
    assert.equal(
      livingFxCanAutoFill({
        ...draft,
        fx: { ...draft.fx, [field]: 'existing' },
      }),
      false,
    );
  for (const provenance of ['manual', 'imported'] as const)
    assert.equal(
      livingFxCanAutoFill({ ...draft, fx: { ...draft.fx, provenance } }),
      false,
    );
  assert.equal(
    livingFxCanAutoFill({
      ...draft,
      fx: { ...draft.fx, provenance: 'automatic' },
    }),
    true,
  );
  assert.equal(
    livingFxCanAutoFill({
      ...draft,
      days: draft.days.map((day) => ({ ...day, kind: 'personal' })),
    }),
    false,
  );
});

test('trip form preserves recovery instructions without exposing unknown diagnostics', () => {
  const known = '日期格式不正確。';
  assert.equal(tripFormError(new Error(known)), known);
  const grouped =
    '7/15～7/16 已合併為同一欄，但各日適用的日支額不同。請先拆開此欄，再分別設定。';
  assert.equal(tripFormError(new Error(grouped)), grouped);
  const diagnostic =
    "TypeError: Cannot read properties of undefined (reading 'fx')";
  assert.doesNotMatch(
    tripFormError(new Error(diagnostic)),
    /TypeError|undefined/,
  );
  assert.match(tripFormError(undefined), /原有內容仍保留/);
});
