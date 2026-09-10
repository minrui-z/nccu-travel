import { canGroupDays, civilDay, addDays } from './claim/claim-engine';
import type { DailyEntry, DateGroup } from './claim/types';

type GroupedDays = { days: DailyEntry[]; groups: DateGroup[] };
type DayTransform = (day: DailyEntry) => DailyEntry;

const dateLabel = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function groupLabel(days: DailyEntry[]): string {
  const first = dateLabel(days[0].date);
  return days.length === 1
    ? first
    : `${first}～${dateLabel(days.at(-1)!.date)}`;
}

function assertCompatible(days: DailyEntry[]): void {
  if (canGroupDays(days)) return;
  const label = groupLabel(days);
  const consecutive = days.every(
    (day, index) =>
      index === 0 || addDays(days[index - 1].date, 1) === day.date,
  );
  const detail = !consecutive
    ? '日期不連續'
    : days.some((day) => day.usdRate.trim() !== days[0].usdRate.trim())
      ? '各日適用的日支額不同'
      : '各日的地點、工作、當日狀態或膳宿條件不同';
  throw new Error(
    `${label} 已合併為同一欄，但${detail}。請先拆開此欄，再分別設定。`,
  );
}

function dayIndex(days: DailyEntry[]): Map<string, DailyEntry> {
  const result = new Map<string, DailyEntry>();
  const dates = new Set<string>();
  for (const day of days) {
    if (
      !day.id ||
      result.has(day.id) ||
      civilDay(day.date) === null ||
      dates.has(day.date)
    )
      throw new Error('日期資料不完整或重複，請重新設定行程日期。');
    result.set(day.id, day);
    dates.add(day.date);
  }
  return result;
}

/** Apply a bulk edit atomically, retaining the user's existing date columns. */
export function replaceGroupedDays<T extends GroupedDays>(
  draft: T,
  nextDays: DailyEntry[],
): T {
  if (
    nextDays.length !== draft.days.length ||
    nextDays.some(
      (day, index) =>
        day.id !== draft.days[index].id || day.date !== draft.days[index].date,
    )
  )
    throw new Error('修改欄位內容時不能變更日期；請使用行程起訖日期調整。');

  const next = dayIndex(nextDays);
  for (const group of draft.groups) {
    const entries = group.dayIds.map((id) => next.get(id));
    if (!entries.length || entries.some((entry) => !entry))
      throw new Error('日期欄資料已變更，請重新選取日期。');
    const changed = group.dayIds.some((id) => {
      const index = draft.days.findIndex((day) => day.id === id);
      return nextDays[index] !== draft.days[index];
    });
    if (changed) assertCompatible(entries as DailyEntry[]);
  }
  return { ...draft, days: nextDays, groups: draft.groups };
}

/** Edits to any day in a merged column apply to every member of that column. */
export function updateGroupDays<T extends GroupedDays>(
  draft: T,
  activeDayId: string,
  transform: DayTransform,
): T {
  if (!draft.days.some((day) => day.id === activeDayId))
    throw new Error('找不到選取的日期，請重新選取日期欄。');
  const group = draft.groups.find((entry) =>
    entry.dayIds.includes(activeDayId),
  );
  const members = new Set(group?.dayIds ?? [activeDayId]);
  const nextDays = draft.days.map((day) => {
    if (!members.has(day.id)) return day;
    // A callback may mutate its argument; never give it the saved draft object.
    const editable = {
      ...day,
      ...(day.transit ? { transit: { ...day.transit } } : {}),
    };
    return transform(editable);
  });
  return replaceGroupedDays(draft, nextDays);
}

/** Keep surviving date memberships; newly added dates begin as single columns. */
export function preserveDateGroups(
  previous: GroupedDays,
  nextDays: DailyEntry[],
): DateGroup[] {
  const oldById = dayIndex(previous.days);
  dayIndex(nextDays);
  const nextByDate = new Map(nextDays.map((day) => [day.date, day]));
  const nextPosition = new Map(nextDays.map((day, index) => [day.id, index]));
  const assigned = new Set<string>();
  const usedGroupIds = new Set<string>();
  const groups: DateGroup[] = [];
  for (const group of previous.groups) {
    if (usedGroupIds.has(group.id))
      throw new Error('日期欄資料重複，請重新設定行程日期。');
    usedGroupIds.add(group.id);
    const entries: DailyEntry[] = [];
    for (const id of group.dayIds) {
      const old = oldById.get(id);
      if (!old) throw new Error('日期欄資料已變更，請重新選取日期。');
      const next = nextByDate.get(old.date);
      if (!next) continue;
      if (assigned.has(next.id))
        throw new Error('同一日期出現在不同欄位，請重新設定行程日期。');
      assigned.add(next.id);
      entries.push(next);
    }
    if (!entries.length) continue;
    assertCompatible(entries);
    const ids = entries.map((entry) => entry.id);
    groups.push(
      ids.length === group.dayIds.length &&
        ids.every((id, index) => id === group.dayIds[index])
        ? group
        : { ...group, dayIds: ids },
    );
  }
  for (const day of nextDays) {
    if (assigned.has(day.id)) continue;
    const base = `group-${day.id}`;
    let id = base;
    let suffix = 2;
    while (usedGroupIds.has(id)) id = `${base}-${suffix++}`;
    usedGroupIds.add(id);
    groups.push({ id, dayIds: [day.id] });
  }
  return groups.sort(
    (a, b) => nextPosition.get(a.dayIds[0])! - nextPosition.get(b.dayIds[0])!,
  );
}
