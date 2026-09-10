import type { Draft, Expense } from './claim/types';

const emptyFx = {
  fxRate: '',
  fxDate: '',
  fxProofNote: '',
  fxProvenance: undefined,
  cashUnavailable: false,
  botUnavailable: false,
  manualBasis: 'bank' as const,
};

/** A quote belongs to one currency, date and payment basis. */
export function updateExpense(
  expense: Expense,
  update: Partial<Expense>,
): Expense {
  let next = { ...expense, ...update };
  if (
    (Object.hasOwn(update, 'fxRate') ||
      Object.hasOwn(update, 'fxProofNote') ||
      Object.hasOwn(update, 'cashUnavailable') ||
      Object.hasOwn(update, 'botUnavailable')) &&
    !Object.hasOwn(update, 'fxProvenance')
  )
    next.fxProvenance = 'manual';
  if (update.currency !== undefined && update.currency !== expense.currency)
    next = {
      ...next,
      ...emptyFx,
      fxSource: 'bot-cash',
      cardTwd: '',
      cardFeeTwd: '',
    };
  else if (update.payment !== undefined && update.payment !== expense.payment)
    next = {
      ...next,
      ...emptyFx,
      fxSource: 'bot-cash',
      cardTwd: '',
      cardFeeTwd: '',
    };
  else if (
    !Object.hasOwn(update, 'fxRate') &&
    ((update.fxSource !== undefined && update.fxSource !== expense.fxSource) ||
      (update.manualBasis !== undefined &&
        update.manualBasis !== expense.manualBasis))
  )
    next = { ...next, ...emptyFx, ...update };
  else if (
    !Object.hasOwn(update, 'fxRate') &&
    update.fxDate !== undefined &&
    update.fxDate !== expense.fxDate
  )
    next = {
      ...next,
      fxRate: '',
      fxProofNote: '',
      fxProvenance: update.fxProvenance ?? 'manual',
      cashUnavailable: false,
      botUnavailable: false,
    };
  if (update.category !== undefined && update.category !== expense.category) {
    next.foreignTaxi = update.foreignTaxi ?? false;
    next.administrativeType = undefined;
  }
  return next;
}

export function expenseFxContext(expense: Expense): string {
  return JSON.stringify([
    expense.currency,
    expense.payment,
    expense.fxDate,
    expense.fxSource,
    expense.manualBasis,
    expense.fxRate,
    expense.fxProofNote,
    expense.cashUnavailable,
    expense.botUnavailable,
    expense.fxProvenance,
  ]);
}

export function updateLivingFx(
  fx: Draft['fx'],
  update: Partial<Draft['fx']>,
): Draft['fx'] {
  const next = { ...fx, ...update };
  if (Object.hasOwn(update, 'rate'))
    return { ...next, provenance: update.provenance ?? 'manual' };
  if (
    (update.source !== undefined && update.source !== fx.source) ||
    (update.manualBasis !== undefined && update.manualBasis !== fx.manualBasis)
  )
    return {
      ...next,
      rate: '',
      rateDate: '',
      proofNote: '',
      provenance: update.provenance,
    };
  if (update.rateDate !== undefined && update.rateDate !== fx.rateDate)
    return { ...next, rate: '', proofNote: '', provenance: update.provenance };
  return next;
}
