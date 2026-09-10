import { autoGroupDays, createEmptyDraft, makeDays } from './claim/claim-engine';
import { changeDayKind, editTransitEndpoint } from './trip-locations';
import type { Draft, Expense, Template } from './claim/types';

/** Public teaching content; independent of regression fixtures and persisted drafts. */
export function createPublicExample(template: Template): Draft {
  const draft = createEmptyDraft();
  Object.assign(draft, {
    template, person: { name: '陳怡安', identifier: template === 'student' ? '115000001' : '000001', title: template === 'student' ? '研究生' : '研究人員', grade: '' },
    purpose: '出席國際學術會議並發表論文',
    startDate: '2026-09-01', endDate: '2026-09-04', approvedStart: '2026-09-01', approvedEnd: '2026-09-04',
    fundingLimit: template === 'student' ? '36000' : '', receiptCount: '3', notes: '',
    fx: { source: 'manual', manualBasis: 'bank', rate: '31.5', rateDate: '2026-08-31', proofNote: '填寫範例匯率', provenance: 'manual' },
  });
  draft.days = makeDays(draft.startDate, draft.endDate, { location: '美國波士頓', work: '出席會議', usdRate: '395' });
  draft.days[0] = editTransitEndpoint(editTransitEndpoint(changeDayKind(draft.days[0], 'flight'), 'from', '臺北'), 'to', '波士頓');
  draft.days[0].work = '交通工具歇夜';
  draft.days[1].work = '發表論文';
  draft.days[1].lunch = true;
  draft.days[2] = changeDayKind(draft.days[2], 'personal');
  draft.days[2].location = '波士頓';
  draft.days[3] = editTransitEndpoint(editTransitEndpoint(changeDayKind(draft.days[3], 'return'), 'from', '波士頓'), 'to', '臺北');
  draft.days[3].work = '返國';
  const expense = (id: string, category: Expense['category'], amount: string, currency: string, rate: string, description: string): Expense => ({
    id, category, amount, currency, fxRate: rate, description, date: '2026-09-01', payment: 'cash', cardTwd: '', cardFeeTwd: '', receipt: '', foreignTaxi: false,
    fxSource: 'manual', manualBasis: 'bank', fxDate: '2026-08-31', fxProofNote: '填寫範例匯率', fxProvenance: 'manual',
  });
  draft.expenses = [expense('example-flight', 'flight', '22000', 'TWD', '1', '來回機票'), expense('example-conference', 'registration', '350', 'USD', '31.2', '會議註冊費'), expense('example-land', 'land', '35', 'USD', '31.7', '機場接駁')];
  draft.funding!.priorApproval = true;
  draft.groups = autoGroupDays(draft.days);
  return draft;
}
