import type { Calculation, Draft, Expense, Issue } from './claim/types';

export function expenseIssues(
  expense: Expense,
  index: number,
  issues: Issue[],
): Issue[] {
  const prefix = `expenses.${index}`;
  return issues.filter(
    (issue) =>
      issue.severity === 'error' &&
      (issue.path === prefix ||
        issue.path.startsWith(prefix + '.') ||
        (expense.category === 'insurance' &&
          issue.path.startsWith('insurance.')) ||
        (expense.category === 'flight' &&
          (issue.path === 'cabin' ||
            issue.path.startsWith('cabin.') ||
            ['economyClaimOnly', 'airfareExplanation'].includes(issue.path))) ||
        (expense.category === 'registration' &&
          issue.code === 'registration-approval')),
  );
}

export function requestedExpenseId(
  draft: Draft,
  path?: string,
): string | undefined {
  if (!path) return undefined;
  const index = path.match(/^expenses\.(\d+)(?:\.|$)/)?.[1];
  if (index !== undefined) return draft.expenses[Number(index)]?.id;
  const category = /^insurance(?:$|\.|Selection)/.test(path)
    ? 'insurance'
    : /^(?:cabin(?:\.|$)|foreignAirline$|economyClaimOnly$|airfareExplanation$)/.test(
          path,
        )
      ? 'flight'
      : /^(?:administrativeApproval|funding\.priorApproval)$/.test(path)
        ? 'registration'
        : undefined;
  return category
    ? draft.expenses.find((expense) => expense.category === category)?.id
    : path === 'expenses'
      ? draft.expenses[0]?.id
      : undefined;
}

export function expenseFxComplete(
  expense: Expense,
  index: number,
  calculation: Calculation,
): boolean {
  const prefix = `expenses.${index}.`;
  return (
    !!expense.fxRate &&
    !!expense.fxDate &&
    !calculation.issues.some(
      (issue) =>
        issue.severity === 'error' &&
        issue.path.startsWith(prefix) &&
        /^(fx|manualBasis|cashUnavailable|botUnavailable)/.test(
          issue.path.slice(prefix.length),
        ),
    )
  );
}

export function formatExpenseAmount(value: string | null | undefined): string {
  if (!value) return '金額待填';
  const [whole, fraction] = value.split('.');
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    (fraction ? '.' + fraction : '')
  );
}
