import { fxDepartureDate, fxReferenceDate } from './claim/claim-engine';
import type { Draft, Expense } from './claim/types';
import { expenseFxContext } from './expense-state';
import type { FxSnapshot } from './public-data';
import { FxInputError } from './fx-errors';
import { isProtectedExpenseQuote } from './fx-provenance';

export interface ExpenseFxRequest {
  expenseId: string;
  departureDate: string;
  quotationDate: string;
  currency: string;
  source: 'bot-cash' | 'bot-spot';
  context: string;
  preserveDate: boolean;
}
export function isAutomaticExpenseFx(expense: Expense): boolean {
  return (
    expense.payment === 'cash' &&
    /^[A-Z]{3}$/.test(expense.currency.trim().toUpperCase()) &&
    !['TWD', 'NTD'].includes(expense.currency.trim().toUpperCase()) &&
    (expense.fxSource === 'bot-cash' || expense.fxSource === 'bot-spot')
  );
}
export function automaticExpenseFxRequest(
  expense: Expense,
  draft: Pick<Draft, 'startDate' | 'approvedStart'>,
): ExpenseFxRequest | null {
  const departureDate = fxDepartureDate(draft);
  const referenceDate = fxReferenceDate(departureDate);
  const preserveDate = isProtectedExpenseQuote(expense);
  const quotationDate = (preserveDate && expense.fxDate) || referenceDate;
  if (!isAutomaticExpenseFx(expense) || !referenceDate || !quotationDate) return null;
  return {
    expenseId: expense.id,
    departureDate,
    quotationDate,
    currency: expense.currency.trim().toUpperCase(),
    source: expense.fxSource as 'bot-cash' | 'bot-spot',
    context: expenseFxContext(expense),
    preserveDate,
  };
}
export function expenseFxRequestKey(request: ExpenseFxRequest): string {
  return request.departureDate + '|' + request.context;
}

/** Unedited bank quotes follow departure; dates chosen by the user stay independent. */
export function prepareAutomaticExpenseDates<T extends Draft>(draft: T): T {
  const date = fxReferenceDate(fxDepartureDate(draft)) ?? '';
  let changed = false;
  const expenses = draft.expenses.map((expense) => {
    if (isProtectedExpenseQuote(expense)) return expense;
    if (!isAutomaticExpenseFx(expense) || (expense.fxDate ?? '') === date)
      return expense;
    changed = true;
    return { ...expense, fxDate: date, ...emptyExpenseFxResult };
  });
  return changed ? { ...draft, expenses } : draft;
}
export const emptyExpenseFxResult: Partial<Expense> = {
  fxRate: '',
  fxProofNote: '',
  fxProvenance: undefined,
  cashUnavailable: false,
  botUnavailable: false,
};
const positive = (value: string | null | undefined): value is string =>
  typeof value === 'string' &&
  /^\d+(?:\.\d+)?$/.test(value) &&
  Number(value) > 0 &&
  Number.isFinite(Number(value));

/** Only one exact date is requested. An absent weekday is not holiday evidence. */
export async function loadExpenseFxQuote(
  request: ExpenseFxRequest,
  loadSnapshot: (date: string) => Promise<FxSnapshot>,
): Promise<Partial<Expense>> {
  let snapshot: FxSnapshot;
  try {
    snapshot = await loadSnapshot(request.quotationDate);
  } catch {
    throw new FxInputError(
      `尚未取得 ${request.quotationDate} 的匯率，請匯入當日臺銀匯率檔，或自行填寫並附來源。`,
    );
  }
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.quotationDate !== request.quotationDate
  )
    throw new FxInputError('匯率資料日期不符，請核對官方報價日期。');
  const quote = snapshot.currencyRates[request.currency];
  const hasCash = positive(quote?.cashSelling);
  if (request.source === 'bot-spot' && hasCash)
    throw new FxInputError(
      '臺銀提供此幣別的現金賣出報價，請將匯率來源改為「臺灣銀行・現金賣出」。',
    );
  const rate = hasCash ? quote.cashSelling : quote?.spotSelling;
  if (!positive(rate))
    throw new FxInputError(
      `臺銀未提供 ${request.currency} 的有效賣出報價；請依適用結匯憑證或央行資料填寫。`,
    );
  return {
    fxRate: rate,
    fxDate: snapshot.quotationDate,
    fxSource: hasCash ? 'bot-cash' : 'bot-spot',
    fxProofNote: snapshot.sourceUrl + (hasCash ? '' : '；此幣別無現金賣出報價'),
    // A user-selected date remains protected even when its rate is fetched.
    fxProvenance: request.preserveDate ? 'manual' : 'automatic',
    cashUnavailable: !hasCash,
    botUnavailable: false,
  };
}

/** Resolve against the latest draft so asynchronous quotes preserve unrelated edits. */
export function applyExpenseFxResult<T extends Draft>(
  draft: T,
  request: ExpenseFxRequest,
  result: Partial<Expense>,
): T {
  const expense = draft.expenses.find((item) => item.id === request.expenseId);
  if (
    !expense ||
    fxDepartureDate(draft) !== request.departureDate ||
    expenseFxContext(expense) !== request.context
  )
    return draft;
  return {
    ...draft,
    expenses: draft.expenses.map((item) =>
      item.id === request.expenseId ? { ...item, ...result } : item,
    ),
  };
}
