import type { WorkbenchDraft } from '../app/model';
import { fxDepartureDate, fxReferenceDate } from './claim/claim-engine';
import { normalizePrivateDays } from './trip-locations';

const receiptBasis = (source: string | undefined, basis: string | undefined) =>
  source === 'receipt' || (source === 'manual' && basis === 'receipt');

/** Invalidate confirmations and quotes when the facts they were based on change. */
export function normalizeDraftTransition(
  previous: WorkbenchDraft,
  incoming: WorkbenchDraft,
): WorkbenchDraft {
  const next = { ...normalizePrivateDays(incoming) };
  const claimedDates = (draft: WorkbenchDraft) =>
    draft.days
      .filter((day) => day.kind !== 'personal')
      .map((day) => day.date)
      .join('|');
  if (
    previous.startDate !== next.startDate ||
    previous.endDate !== next.endDate ||
    claimedDates(previous) !== claimedDates(next)
  )
    next.insurance = { ...next.insurance, capConfirmed: false };
  if (
    fxReferenceDate(fxDepartureDate(previous)) !==
    fxReferenceDate(fxDepartureDate(next))
  ) {
    if (!receiptBasis(next.fx.source, next.fx.manualBasis))
      next.fx = { ...next.fx, rate: '', rateDate: '', proofNote: '', provenance: undefined };
    next.expenses = next.expenses.map((expense) =>
      expense.payment === 'cash' &&
      !['TWD', 'NTD'].includes(expense.currency.trim().toUpperCase()) &&
      !receiptBasis(expense.fxSource, expense.manualBasis)
        ? {
            ...expense,
            fxRate: '',
            fxDate: '',
            fxProofNote: '',
            fxProvenance: undefined,
            cashUnavailable: false,
            botUnavailable: false,
          }
        : expense,
    );
  }
  if (next.funding) {
    next.funding = { ...next.funding };
    if (previous.funding?.type !== next.funding.type) {
      next.funding.priorApproval = false;
      next.funding.approvedItems = false;
      next.funding.sharingApproved = false;
      next.funding.changeApproved = false;
    }
    if (!next.funding.shared) next.funding.sharingApproved = false;
    if (!next.funding.planChanged) next.funding.changeApproved = false;
  }
  if (next.cabin.standard) {
    next.economyClaimOnly = false;
    next.airfareExplanation = '';
  }
  return next;
}
