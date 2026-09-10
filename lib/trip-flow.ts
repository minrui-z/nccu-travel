import type { WorkbenchDraft } from '../app/model';
import { addDays, canGroupDays, makeDays } from './claim/claim-engine';
import { preserveDateGroups } from './trip-groups';

export interface TripDateRange {
  start: string;
  end: string;
}

export function describeTripDates(dates: string[]): string {
  const ranges: Array<{ start: string; end: string }> = [];
  for (const date of dates) {
    const last = ranges.at(-1);
    if (last && addDays(last.end, 1) === date) last.end = date;
    else ranges.push({ start: date, end: date });
  }
  return ranges
    .map(({ start, end }) => (start === end ? start : `${start}～${end}`))
    .join('、');
}

/** Only these domain messages may be shown directly by the trip form. */
export function tripFormError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const knownMessages = new Set([
    '請填寫有效的出發與返國日期，返國日期不可早於出發日期。',
    '日期格式不正確。',
    '單次行程最多支援 366 日。',
    '日期資料不完整或重複，請重新設定行程日期。',
    '修改欄位內容時不能變更日期；請使用行程起訖日期調整。',
    '日期欄資料已變更，請重新選取日期。',
    '找不到選取的日期，請重新選取日期欄。',
    '日期欄資料重複，請重新設定行程日期。',
    '同一日期出現在不同欄位，請重新設定行程日期。',
    '此日期沒有適用的官方日支數額，請核對資料生效日期。',
    '官方日支額資料尚未載入，請稍後再套用地點。',
    '行程日期已變更，無法復原這次合併。請重新選擇日期。',
    '日期內容已分別修改，無法復原為同一欄。請重新核對地點與膳宿條件。',
  ]);
  const groupedDateMessage =
    /^\d{1,2}\/\d{1,2}(?:～\d{1,2}\/\d{1,2})? 已合併為同一欄，但(?:日期不連續|各日適用的日支額不同|各日的地點、工作、當日狀態或膳宿條件不同)。請先拆開此欄，再分別設定。$/;
  return knownMessages.has(message) || groupedDateMessage.test(message)
    ? message
    : '這次修改未完成，原有內容仍保留。請重新選取日期後再試。';
}

/** Prepare the entire date change before touching the saved report. */
export function prepareTripDates(draft: WorkbenchDraft, range: TripDateRange) {
  const fresh = makeDays(range.start, range.end);
  if (!fresh.length)
    throw new Error('請填寫有效的出發與返國日期，返國日期不可早於出發日期。');
  const days = fresh.map(
    (entry) => draft.days.find((old) => old.date === entry.date) ?? entry,
  );
  const removed = draft.days.filter(
    (entry) => entry.date < range.start || entry.date > range.end,
  );
  const affectedExpenses = draft.expenses.filter(
    (expense) => expense.date < range.start || expense.date > range.end,
  );
  const referenceFollowsDeparture =
    !draft.approvedStart || draft.approvedStart === draft.startDate;
  return {
    removed,
    affectedExpenses,
    draft: {
      ...draft,
      startDate: range.start,
      endDate: range.end,
      days,
      groups: preserveDateGroups(draft, days),
      destinationIds: Object.fromEntries(
        days.map((entry) => [entry.id, draft.destinationIds?.[entry.id] ?? '']),
      ),
      approvedStart: referenceFollowsDeparture
        ? range.start
        : draft.approvedStart,
      approvedEnd: draft.approvedEnd || range.end,
    } satisfies WorkbenchDraft,
  };
}

/** Undo changes to date columns only; never overwrite edits made since then. */
export function restoreTripGroups(
  draft: WorkbenchDraft,
  groups: WorkbenchDraft['groups'],
): WorkbenchDraft {
  const ids = groups.flatMap((group) => group.dayIds);
  if (
    ids.length !== draft.days.length ||
    ids.some((id, index) => draft.days[index]?.id !== id)
  )
    throw new Error('行程日期已變更，無法復原這次合併。請重新選擇日期。');
  const byId = new Map(draft.days.map((day) => [day.id, day]));
  if (
    groups.some(
      (group) => !canGroupDays(group.dayIds.map((id) => byId.get(id)!)),
    )
  )
    throw new Error(
      '日期內容已分別修改，無法復原為同一欄。請重新核對地點與膳宿條件。',
    );
  return { ...draft, groups };
}

export function livingFxCanAutoFill(draft: WorkbenchDraft): boolean {
  return (
    draft.days.some((day) => day.kind !== 'personal') &&
    draft.fx.source === 'bot' &&
    draft.fx.provenance !== 'manual' &&
    draft.fx.provenance !== 'imported' &&
    !draft.fx.rate.trim() &&
    !draft.fx.rateDate.trim() &&
    !draft.fx.proofNote.trim()
  );
}
