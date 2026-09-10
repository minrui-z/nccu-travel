import type { Draft, Expense, FxProvenance } from './claim/types';

export function isProtectedExpenseQuote(expense: Expense): boolean {
  return (
    expense.fxProvenance === 'manual' || expense.fxProvenance === 'imported'
  );
}

function migrateProvenance(
  current: FxProvenance | undefined,
  rate: string,
  proof: string | undefined,
): FxProvenance | undefined {
  if (current) return current;
  if (!rate.trim()) return undefined;
  // This is the sole compatibility bridge for drafts saved before provenance
  // was stored separately. New UI copy must never control quote ownership.
  return proof?.startsWith('官方 CSV：') ? 'imported' : 'manual';
}

/** Preserve existing amounts and evidence when restoring older drafts. */
export function normalizeFxProvenance<T extends Draft>(draft: T): T {
  return {
    ...draft,
    fx: {
      ...draft.fx,
      provenance: migrateProvenance(
        draft.fx.provenance,
        draft.fx.rate,
        draft.fx.proofNote,
      ),
    },
    expenses: draft.expenses.map((expense) => ({
      ...expense,
      fxProvenance: migrateProvenance(
        expense.fxProvenance,
        expense.fxRate,
        expense.fxProofNote,
      ),
    })),
  };
}
