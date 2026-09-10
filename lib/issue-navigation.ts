import type { Draft, Issue } from './claim/types';
import type { CapacityIssue } from './xls/claim-mapping';

export type ReviewIssue = Issue & {
  relatedFields?: Array<{ path: string; label: string }>;
};

/** Resolve template coordinates to the same inputs used by validation links. */
export function capacityIssuesForDraft(
  issues: CapacityIssue[],
  draft: Draft,
): CapacityIssue[] {
  const fields: Record<string, string> = {
    name: 'person.name',
    identity: 'person.identifier',
    title: 'person.title',
    grade: 'person.grade',
    reason: 'purpose',
    period: 'startDate',
    total: 'fundingLimit',
    notes: 'notes',
    voucherNumber: 'voucherNumber',
    budgetItem: 'budgetItem',
  };
  return issues.map((issue) => {
    const segmentIndexes =
      issue.segmentIndexes ??
      (issue.segmentIndex === undefined ? [] : [issue.segmentIndex]);
    const groups = segmentIndexes.flatMap((index) =>
      draft.groups[index] ? [draft.groups[index]] : [],
    );
    const days = groups
      .flatMap((group) => group.dayIds)
      .flatMap((id) => {
        const index = draft.days.findIndex((day) => day.id === id);
        return index < 0 ? [] : [{ ...draft.days[index], index }];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const dates = new Set(days.map((day) => day.date));
    const start = days[0],
      last = days.at(-1);
    const first =
      issue.fieldKey === 'work'
        ? days.find((day) => day.kind !== 'personal')
        : start;
    const date = start
      ? start.date === last?.date
        ? start.date
        : `${start.date} 至 ${last?.date}`
      : '';
    const relatedFields: Array<{ path: string; label: string }> = [];
    let path = fields[issue.fieldKey] ?? 'notes';
    if (first) {
      const dayFields: Record<string, string> = {
        month: '',
        day: '',
        location: first.kind === 'flight' ? 'transit.from' : 'location',
        work: 'work',
        living: 'usdRate',
        deduction: 'extraDeductionUsd',
      };
      if (Object.hasOwn(dayFields, issue.fieldKey)) {
        path = `days.${first.index}${dayFields[issue.fieldKey] ? `.${dayFields[issue.fieldKey]}` : ''}`;
        if (issue.fieldKey === 'location' && first.kind === 'flight') {
          relatedFields.push({
            path: `days.${first.index}.transit.to`,
            label: '抵達地點',
          });
        }
        if (issue.fieldKey === 'work') {
          groups.forEach((group) => {
            const day = days.find(
              (day) => group.dayIds.includes(day.id) && day.kind !== 'personal',
            );
            if (day && day.index !== first.index)
              relatedFields.push({
                path: `days.${day.index}.work`,
                label: `${day.date} 工作記要`,
              });
          });
        }
      } else {
        const expenses = draft.expenses
          .map((expense, index) => ({ ...expense, index }))
          .filter(
            (expense) =>
              dates.has(expense.date) &&
              (issue.fieldKey === 'receipt' ||
                expense.category === issue.fieldKey),
          );
        if (expenses.length) {
          path = `expenses.${expenses[0].index}${issue.fieldKey === 'receipt' ? '.receipt' : ''}`;
          expenses.slice(1).forEach((expense) =>
            relatedFields.push({
              path: `expenses.${expense.index}${issue.fieldKey === 'receipt' ? '.receipt' : ''}`,
              label: `費用 ${expense.index + 1}${expense.description ? `：${expense.description}` : ''}`,
            }),
          );
        } else path = `days.${first.index}`;
      }
    } else if (days.length) path = 'groups';
    const label = `${date ? `${date} 的` : ''}${issue.label}`;
    const generated =
      /^(living|deduction|flight|ship|land|handling|insurance|registration|misc|total)$/.test(
        issue.fieldKey,
      );
    return {
      ...issue,
      path,
      relatedFields,
      message:
        issue.fieldKey === 'total'
          ? `${label}超出表格空間，請核對申請金額與相關費用。`
          : generated
            ? `${label}超出表格空間。請檢查相關資料，或合併相同內容的日期以增加欄位寬度。`
            : `${label}超出表格空間，請精簡文字${/^(location|work)$/.test(issue.fieldKey) ? '或合併相同內容的日期' : ''}。`,
    };
  });
}

export function destinationForIssue(
  issue: Pick<Issue, 'path'>,
  draft: Draft,
): { tab: string; focus: string } {
  const path = issue.path;
  if (
    path === 'funding.priorApproval' &&
    draft.expenses.some((expense) => expense.category === 'registration') &&
    (draft.funding?.type === 'other' ||
      draft.expenses.some(
        (expense) =>
          expense.category === 'registration' &&
          expense.administrativeType === 'other',
      ))
  )
    return { tab: 'cost', focus: 'expenses' };
  const dayIndex = /^days\.(\d+)/.exec(path)?.[1];
  if (dayIndex !== undefined) {
    const day = draft.days[Number(dayIndex)];
    return { tab: 'trip', focus: day ? `day:${day.id}` : 'period' };
  }
  const groupIndex = /^groups\.(\d+)/.exec(path)?.[1];
  if (groupIndex !== undefined) {
    const dayId = draft.groups[Number(groupIndex)]?.dayIds[0];
    return { tab: 'trip', focus: dayId ? `day:${dayId}` : 'period' };
  }
  if (/^(expenses|insurance|cabin)/.test(path))
    return { tab: 'cost', focus: 'expenses' };
  if (/^(days|groups|startDate|endDate|approved)/.test(path))
    return { tab: 'trip', focus: 'period' };
  if (path.startsWith('fx')) return { tab: 'trip', focus: 'fx' };
  if (/^(person|purpose|funding|budget|voucher)/.test(path))
    return {
      tab: 'person',
      focus:
        path === 'fundingLimit'
          ? 'total'
          : path === 'purpose'
            ? 'purpose'
            : /^(budget|voucher)/.test(path)
              ? 'budget'
              : 'person',
    };
  return { tab: 'check', focus: path === 'receiptCount' ? 'period' : 'notes' };
}

/** Exact input first, then the closest editable section for structural issues. */
export function fieldPathCandidates(path: string): string[] {
  const candidates = [path];
  const parts = path.split('.');
  while (parts.length > 1) {
    parts.pop();
    candidates.push(parts.join('.'));
  }
  return candidates;
}
