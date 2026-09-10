import type { WorkbenchDraft } from '../app/model';

export interface DocumentCheck {
  id: string;
  label: string;
  hint?: string;
}
export function requiredDocuments(draft: WorkbenchDraft): DocumentCheck[] {
  const hasFlight = draft.expenses.some(
    (expense) => expense.category === 'flight',
  );
  const list: DocumentCheck[] = [
    {
      id: 'agenda',
      label: '邀請函或會議議程',
      hint: '包含會議名稱、地點及期間的頁面。',
    },
    { id: 'transfer-list', label: '轉帳清冊' },
  ];
  if (draft.expenses.length)
    list.push({
      id: 'original-receipts',
      label: '各項原始單據',
      hint: '依費用整理憑證與票根，另以 A4 紙黏貼；有自編單據號數時請標示對應。',
    });
  if (
    draft.days.some(
      (day) => day.kind !== 'personal' && day.usdRate && day.usdRate !== '0',
    )
  )
    list.push({
      id: 'living-fx',
      label:
        draft.fx.source === 'receipt'
          ? '生活費美元結匯水單或匯率證明'
          : '生活費美元匯率證明',
      hint:
        draft.fx.source === 'receipt'
          ? '日期介於奉派出差前 15 日至返國日。'
          : '依奉派出差基準日選用臺銀美元現金賣出報價；手動資料請附來源。',
    });
  if (
    draft.expenses.some(
      (expense) =>
        expense.payment === 'cash' &&
        !['TWD', 'NTD'].includes(expense.currency.toUpperCase()),
    )
  )
    list.push({
      id: 'expense-fx',
      label: '外幣費用的結匯或指定報價證明',
      hint: '每筆使用不同匯率時，分別保留對應日期與幣別的來源。',
    });
  if (draft.expenses.some((expense) => expense.category === 'flight'))
    list.push(
      { id: 'flight-itinerary', label: '機票票根、電子機票或行程證明' },
      {
        id: 'flight-payment',
        label: '機票購票證明或旅行業代收轉付收據',
        hint: '網路列印的旅行業代收轉付收據紙本請簽章。',
      },
    );
  if (hasFlight && draft.foreignAirline)
    list.push({
      id: 'foreign-airline',
      label: '搭乘外國籍航空公司班機申請書',
      hint: '由申請人（出差人）簽章。',
    });
  if (
    hasFlight &&
    draft.template === 'general' &&
    !draft.cabin.standard &&
    draft.cabin.seniorEligible
  )
    list.push({
      id: 'cabin-appendix',
      label: '國外出差旅費報告表附表與艙等資格證明',
      hint: '附表保留原格式；實際班次與座艙條件仍須據實填寫。',
    });
  if (hasFlight && !draft.cabin.standard && draft.economyClaimOnly)
    list.push({
      id: 'economy-proof',
      label: '最直接航程經濟艙票價證明',
      hint: '由航空公司或旅行社出具，供核對升等或繞道的可報金額。',
    });
  if (draft.expenses.some((expense) => expense.payment === 'card'))
    list.push({
      id: 'card-statement',
      label: '信用卡帳單',
      hint: '顯示實際結算臺幣與交易手續費。',
    });
  if (
    draft.expenses.some(
      (expense) => expense.payment === 'card' && Number(expense.cardFeeTwd) > 0,
    )
  )
    list.push({ id: 'card-fee-form', label: '信用卡國外交易手續費支出證明單' });
  if (draft.expenses.some((expense) => expense.category === 'insurance'))
    list.push(
      { id: 'insurance-receipt', label: '保險費收據' },
      {
        id: 'insurance-policy',
        label: '保單或保障項目與保額證明',
        hint: '另核對適用共同供應契約的保費上限。',
      },
    );
  if (draft.funding?.type === 'nstc')
    list.push({
      id: 'nstc-role',
      label: '國科會計畫要求的參與身分證明',
      hint: '論文發表、專題演講、主持人證明或個案同意函。',
    });
  if (draft.funding?.type === 'other' && draft.funding.priorApproval)
    list.push({ id: 'funding-approval', label: '經核准簽文、會核單與附件' });
  if (
    draft.funding?.type === 'other' &&
    draft.expenses.some((expense) => expense.category === 'registration')
  )
    list.push({
      id: 'registration-approval',
      label: '註冊／報名費等行政費的核准文件',
    });
  if (draft.funding?.shared)
    list.push({ id: 'funding-sharing', label: '經費分攤簽准與支出科目分攤表' });
  if (draft.funding?.planChanged)
    list.push({ id: 'plan-change', label: '計畫變更申請表或核准同意書函' });
  return list;
}

