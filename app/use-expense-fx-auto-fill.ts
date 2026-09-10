import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  applyExpenseFxResult,
  automaticExpenseFxRequest,
  emptyExpenseFxResult,
  expenseFxRequestKey,
  loadExpenseFxQuote,
  prepareAutomaticExpenseDates,
} from '@/lib/expense-auto-fx';
import { fxDepartureDate } from '@/lib/claim/claim-engine';
import { expenseFxContext } from '@/lib/expense-state';
import { exactSnapshot, type FxSnapshot } from '@/lib/public-data';
import type { WorkbenchDraft } from './model';
import { fxLookupError } from '@/lib/fx-errors';
import { isProtectedExpenseQuote } from '@/lib/fx-provenance';

export interface ExpenseFxStatus {
  state: 'loading' | 'success' | 'error';
  message: string;
}
export interface ExpenseFxAutoFill {
  statuses: Record<string, ExpenseFxStatus>;
  refresh: (expenseId: string) => void;
}
interface ContextStatus extends ExpenseFxStatus {
  key: string;
}

/** Kept on the page, so date changes update expenses even when their tab is closed. */
export function useExpenseFxAutoFill(
  draft: WorkbenchDraft,
  setDraft: Dispatch<SetStateAction<WorkbenchDraft>>,
): ExpenseFxAutoFill {
  const [storedStatuses, setStatuses] = useState<Record<string, ContextStatus>>(
    {},
  );
  const [revision, setRevision] = useState(0);
  const attempted = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, string>());
  const forced = useRef(new Set<string>());
  const snapshots = useRef(new Map<string, Promise<FxSnapshot>>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const prepared = prepareAutomaticExpenseDates(draft);
    if (prepared !== draft)
      setDraft((current) => prepareAutomaticExpenseDates(current));
    for (const expense of prepared.expenses) {
      const request = automaticExpenseFxRequest(expense, prepared);
      if (!request) continue;
      const key = expenseFxRequestKey(request);
      const ownedQuote = isProtectedExpenseQuote(expense);
      if (
        (ownedQuote && !forced.current.has(expense.id)) ||
        attempted.current.get(expense.id) === key ||
        pending.current.get(expense.id) === key
      )
        continue;
      forced.current.delete(expense.id);
      pending.current.set(expense.id, key);
      setStatuses((current) => ({
        ...current,
        [expense.id]: {
          key,
          state: 'loading',
          message: `正在讀取 ${request.quotationDate} ${request.currency} 匯率…`,
        },
      }));
      const readSnapshot = (date: string) => {
        let snapshot = snapshots.current.get(date);
        if (!snapshot) {
          snapshot = exactSnapshot(date).catch((error: unknown) => {
            snapshots.current.delete(date);
            throw error;
          });
          snapshots.current.set(date, snapshot);
        }
        return snapshot;
      };
      void loadExpenseFxQuote(request, readSnapshot)
        .then(
          (result) => {
            if (!mounted.current || pending.current.get(expense.id) !== key)
              return;
            const resultKey =
              request.departureDate +
              '|' +
              expenseFxContext({ ...expense, ...result });
            attempted.current.set(expense.id, resultKey);
            setDraft((current) =>
              applyExpenseFxResult(current, request, result),
            );
            setStatuses((current) => ({
              ...current,
              [expense.id]: {
                key: resultKey,
                state: 'success',
                message: `已自動套用 ${request.quotationDate} ${request.currency} ${result.fxSource === 'bot-cash' ? '現金' : '即期'}賣出匯率 ${result.fxRate}。`,
              },
            }));
          },
          (error: unknown) => {
            if (!mounted.current || pending.current.get(expense.id) !== key)
              return;
            const resultKey =
              request.departureDate +
              '|' +
              expenseFxContext({ ...expense, ...emptyExpenseFxResult });
            attempted.current.set(expense.id, resultKey);
            setDraft((current) =>
              applyExpenseFxResult(current, request, emptyExpenseFxResult),
            );
            setStatuses((current) => ({
              ...current,
              [expense.id]: {
                key: resultKey,
                state: 'error',
                message: fxLookupError(error),
              },
            }));
          },
        )
        .finally(() => {
          if (pending.current.get(expense.id) === key)
            pending.current.delete(expense.id);
        });
    }
  }, [draft, setDraft, revision]);
  const statuses: Record<string, ExpenseFxStatus> = {};
  for (const expense of draft.expenses) {
    const status = storedStatuses[expense.id];
    const key = fxDepartureDate(draft) + '|' + expenseFxContext(expense);
    if (status?.key === key) statuses[expense.id] = status;
  }
  return {
    statuses,
    refresh: (id) => {
      const expense = draft.expenses.find((item) => item.id === id);
      const request = expense && automaticExpenseFxRequest(expense, draft);
      if (request) snapshots.current.delete(request.quotationDate);
      attempted.current.delete(id);
      forced.current.add(id);
      setRevision((value) => value + 1);
    },
  };
}
