import type {
  Calculation,
  Category,
  CategoryCalculation,
  DailyCalculation,
  DailyEntry,
  DateGroup,
  Draft,
  ExpenseCalculation,
  GroupCalculation,
  Issue,
} from './types.ts';
export type * from './types.ts';

/** Exact base-10 arithmetic. Monetary input stays text until the category's HALF_UP boundary. */
class Decimal {
  readonly coefficient: bigint;
  readonly scale: number;
  constructor(coefficient: bigint, scale = 0) {
    this.coefficient = coefficient;
    this.scale = scale;
  }
  static parse(value: string): Decimal {
    if (!/^\d+(?:\.\d+)?$/.test(value.trim()))
      throw new Error('請輸入零或正數。');
    const [whole, fraction = ''] = value.trim().split('.');
    return new Decimal(BigInt(whole + fraction), fraction.length);
  }
  plus(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(
      this.coefficient * 10n ** BigInt(scale - this.scale) +
        other.coefficient * 10n ** BigInt(scale - other.scale),
      scale,
    );
  }
  minus(other: Decimal): Decimal {
    return this.plus(new Decimal(-other.coefficient, other.scale));
  }
  times(other: Decimal): Decimal {
    return new Decimal(
      this.coefficient * other.coefficient,
      this.scale + other.scale,
    );
  }
  percent(value: number): Decimal {
    return new Decimal(this.coefficient * BigInt(value), this.scale + 2);
  }
  compare(other: Decimal): number {
    const n = this.minus(other).coefficient;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  }
  round(): number {
    const divisor = 10n ** BigInt(this.scale);
    const sign = this.coefficient < 0n ? -1n : 1n;
    const absolute = this.coefficient * sign;
    const result =
      sign *
      (absolute / divisor + ((absolute % divisor) * 2n >= divisor ? 1n : 0n));
    const number = Number(result);
    if (!Number.isSafeInteger(number))
      throw new Error('金額超出可安全處理範圍。');
    return number;
  }
  toString(): string {
    const negative = this.coefficient < 0n;
    const raw = (negative ? -this.coefficient : this.coefficient)
      .toString()
      .padStart(this.scale + 1, '0');
    const value = this.scale
      ? `${raw.slice(0, -this.scale)}.${raw.slice(-this.scale)}`.replace(
          /\.?0+$/,
          '',
        )
      : raw;
    return (negative ? '-' : '') + (value || '0');
  }
}
const ZERO = new Decimal(0n);
const categories: Array<[Category | 'living', string]> = [
  ['flight', '飛機'],
  ['ship', '船舶'],
  ['land', '大眾陸運工具'],
  ['living', '生活費'],
  ['handling', '手續費'],
  ['insurance', '保險費'],
  ['registration', '行政費'],
  ['misc', '禮品交際及雜費'],
];
export const CATEGORY_LABELS = Object.fromEntries(categories) as Record<
  Category | 'living',
  string
>;

/** Dates are civil YYYY-MM-DD strings; UTC is used only as an ordinal, never to localize an instant. */
export function civilDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2200) return null;
  const n = Date.UTC(year, month - 1, day);
  const d = new Date(n);
  return d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
    ? n / 86400000
    : null;
}
export function addDays(date: string, count: number): string {
  const n = civilDay(date);
  if (n === null) throw new Error('日期格式不正確。');
  return new Date((n + count) * 86400000).toISOString().slice(0, 10);
}
export function isWeekend(date: string): boolean {
  const n = civilDay(date);
  if (n === null) return false;
  const weekday = new Date(n * 86400000).getUTCDay();
  return weekday === 0 || weekday === 6;
}
export function fxReferenceDate(approvedStart: string): string | null {
  if (civilDay(approvedStart) === null) return null;
  let date = addDays(approvedStart, -1);
  while (isWeekend(date)) date = addDays(date, -1);
  return date;
}
/** Older drafts may keep a separate departure date for the official FX evidence period. */
export function fxDepartureDate(
  draft: Pick<Draft, 'approvedStart' | 'startDate'>,
): string {
  return civilDay(draft.approvedStart) !== null
    ? draft.approvedStart
    : draft.startDate;
}
const localToday = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
};
export function makeDays(
  start: string,
  end: string,
  seed: Partial<DailyEntry> = {},
): DailyEntry[] {
  const a = civilDay(start);
  const b = civilDay(end);
  if (a === null || b === null || b < a) return [];
  if (b - a > 365) throw new Error('單次行程最多支援 366 日。');
  return Array.from({ length: b - a + 1 }, (_, index) => {
    const date = addDays(start, index);
    return {
      location: '',
      work: '',
      usdRate: '',
      kind: index === b - a ? 'return' : 'official',
      lodgingProvided: false,
      breakfast: false,
      lunch: false,
      dinner: false,
      mealsInFlight: false,
      weekendOfficial: false,
      extraDeductionUsd: '',
      ...seed,
      id: `day-${date}`,
      date,
    };
  });
}
const groupingKey = (day: DailyEntry) =>
  day.kind === 'personal'
    ? JSON.stringify(['personal', day.location.trim()])
    : JSON.stringify([
        day.location.trim(),
        day.work.trim(),
        day.usdRate.trim(),
        day.kind,
        day.lodgingProvided,
        day.breakfast,
        day.lunch,
        day.dinner,
        day.mealsInFlight,
        day.extraDeductionUsd.trim() || '0',
      ]);
export function canGroupDays(days: DailyEntry[]): boolean {
  return (
    days.length > 0 &&
    days.every(
      (day, i) =>
        civilDay(day.date) !== null &&
        groupingKey(day) === groupingKey(days[0]) &&
        (i === 0 ||
          (civilDay(days[i - 1].date) !== null &&
            addDays(days[i - 1].date, 1) === day.date)),
    )
  );
}
export function mergeSelection(
  days: DailyEntry[],
  groups: DateGroup[],
  selectedIds: string[],
) {
  const selected = groups.filter((g) => selectedIds.includes(g.id));
  const selectedDays = selected.flatMap((g) => g.dayIds).length;
  try {
    const merged = mergeGroups(days, groups, selectedIds);
    return {
      canMerge: true,
      reason: `已選 ${selected.length} 欄、${selectedDays} 天，可合併為 1 欄。`,
      count: selected.length,
      groups: merged,
    };
  } catch (error) {
    return {
      canMerge: false,
      reason: (error as Error).message,
      count: selected.length,
      groups,
    };
  }
}
function groupingDifferences(a: DailyEntry, b: DailyEntry): string[] {
  if (a.kind === 'personal' && b.kind === 'personal')
    return a.location.trim() === b.location.trim() ? [] : ['地點'];
  const fields: Array<[string, unknown, unknown]> = [
    ['地點', a.location.trim(), b.location.trim()],
    ['工作記要', a.work.trim(), b.work.trim()],
    ['日支額', a.usdRate.trim(), b.usdRate.trim()],
    ['當日狀態', a.kind, b.kind],
    ['住宿', a.lodgingProvided, b.lodgingProvided],
    ['早餐', a.breakfast, b.breakfast],
    ['午餐', a.lunch, b.lunch],
    ['晚餐', a.dinner, b.dinner],
    ['航程供餐', a.mealsInFlight, b.mealsInFlight],
    [
      '其他扣款',
      a.extraDeductionUsd.trim() || '0',
      b.extraDeductionUsd.trim() || '0',
    ],
  ];
  return fields.filter(([, x, y]) => x !== y).map(([label]) => label);
}
export function autoGroupDays(days: DailyEntry[]): DateGroup[] {
  const result: DateGroup[] = [];
  for (const day of days) {
    const last = result[result.length - 1];
    const previous =
      last && days.find((d) => d.id === last.dayIds[last.dayIds.length - 1]);
    if (previous && canGroupDays([previous, day])) last.dayIds.push(day.id);
    else result.push({ id: `group-${day.id}`, dayIds: [day.id] });
  }
  return result;
}
export function mergeGroups(
  days: DailyEntry[],
  groups: DateGroup[],
  selectedGroupIds: string[],
): DateGroup[] {
  const selected = groups.filter((group) =>
    selectedGroupIds.includes(group.id),
  );
  if (selected.length < 2) throw new Error('請選擇至少兩個相鄰日期區段。');
  const indexes = selected.map((group) => groups.indexOf(group));
  if (indexes.some((index, i) => i > 0 && index !== indexes[i - 1] + 1))
    throw new Error('只能合併相鄰日期區段。');
  const ids = selected.flatMap((group) => group.dayIds);
  const entries = ids.map((id) => days.find((day) => day.id === id));
  if (entries.some((day) => !day))
    throw new Error('日期選取已變更，請重新選取。');
  const actual = entries as DailyEntry[];
  if (
    selected.some((group) => group.dayIds.length === 0) ||
    actual.some((day) => civilDay(day.date) === null)
  )
    throw new Error('日期區段資料不完整，請先更新行程。');
  for (let i = 1; i < actual.length; i++) {
    if (addDays(actual[i - 1].date, 1) !== actual[i].date)
      throw new Error('只能合併日期連續的區段。');
    const different = groupingDifferences(actual[i - 1], actual[i]);
    if (different.length)
      throw new Error(
        `${actual[i - 1].date.slice(5)} 與 ${actual[i].date.slice(5)} 的${different.join('、')}不同，請分欄或先修正資料。`,
      );
  }
  return groups.flatMap((group) =>
    group.id === selected[0].id
      ? [{ ...group, dayIds: ids }]
      : selectedGroupIds.includes(group.id)
        ? []
        : [group],
  );
}
export function splitGroup(groups: DateGroup[], groupId: string): DateGroup[] {
  return groups.flatMap((group) =>
    group.id === groupId
      ? group.dayIds.map((id) => ({ id: `group-${id}`, dayIds: [id] }))
      : [group],
  );
}

export function calculateClaim(
  draft: Draft,
  options: { today?: string } = {},
): Calculation {
  const issues: Issue[] = [];
  const today = options.today ?? localToday();
  const issue = (
    severity: Issue['severity'],
    code: string,
    path: string,
    message: string,
  ) => {
    issues.push({ severity, code, path, message });
  };
  const parse = (
    value: string | undefined,
    path: string,
    label: string,
    optional = false,
  ): Decimal | null => {
    if (!value?.trim()) {
      if (optional) return ZERO;
      issue(
        'error',
        'missing-amount',
        path,
        `請填寫${label}。`,
      );
      return null;
    }
    if (!/^\d{1,15}(?:\.\d{1,12})?$/.test(value.trim())) {
      issue(
        'error',
        'invalid-amount',
        path,
        `${label}須為零或正數，最多 15 位整數及 12 位小數。`,
      );
      return null;
    }
    return Decimal.parse(value);
  };
  const required = (value: string | undefined, path: string, label: string) => {
    if (!value?.trim()) issue('error', 'required', path, `請填寫${label}。`);
  };
  required(draft.person.name, 'person.name', '姓名');
  required(
    draft.person.identifier,
    'person.identifier',
    draft.template === 'student' ? '學生證號' : '員工代碼',
  );
  required(draft.person.title, 'person.title', '職稱');
  required(draft.purpose, 'purpose', '出差事由');
  const start = civilDay(draft.startDate);
  const end = civilDay(draft.endDate);
  const fxDeparture = fxDepartureDate(draft);
  if (start === null || end === null || end < start)
    issue(
      'error',
      'trip-dates',
      'startDate',
      '請填寫有效的當地出發與返國日期，返國不可早於出發。',
    );
  if (draft.startDate && draft.startDate < '2026-01-01')
    issue(
      'error',
      'rule-effective-date',
      'startDate',
      '115 年版規則適用於 2026 年 1 月 1 日起的出差案件；較早案件請使用適用年度的規則與表單。',
    );
  const reference = fxReferenceDate(fxDeparture);
  const hasLivingDays = draft.days.some((day) => day.kind !== 'personal');
  const fx = hasLivingDays
    ? parse(draft.fx.rate, 'fx.rate', '生活費美元匯率')
    : null;
  if (fx && fx.compare(ZERO) <= 0)
    issue('error', 'zero-fx', 'fx.rate', '匯率必須大於 0。');
  const validateFx = (
    date: string | undefined,
    source: string,
    proof: string | undefined,
    path: string,
    manualBasis: 'bank' | 'receipt' = 'bank',
  ) => {
    const datePath = `${path}.${path === 'fx' ? 'rateDate' : 'fxDate'}`;
    const proofPath = `${path}.${path === 'fx' ? 'proofNote' : 'fxProofNote'}`;
    if (!date || civilDay(date) === null) {
      issue('error', 'fx-date', datePath, '請填寫匯率資料日期。');
      return;
    }
    if (date > today)
      issue(
        'error',
        'future-fx',
        datePath,
        '此匯率日期尚未到來，請待該日公布後再填寫。',
      );
    const dateBasis =
      source === 'manual'
        ? manualBasis === 'receipt'
          ? 'receipt'
          : 'bot'
        : source;
    if (source === 'manual') {
      required(proof, proofPath, '手動匯率來源');
      issue(
        'warning',
        'manual-fx',
        path,
        `手動匯率請與${manualBasis === 'receipt' ? '有效結匯憑證' : '奉派出差前指定報價資料'}核對；手動輸入仍須符合日期規定。`,
      );
    }
    if (dateBasis === 'receipt') {
      if (
        civilDay(fxDeparture) !== null &&
        (date < addDays(fxDeparture, -15) ||
          (draft.endDate && date > draft.endDate))
      )
        issue(
          'error',
          'fx-receipt-window',
          datePath,
          '結匯憑證日期須在奉派出差前 15 日至返國日期之間。',
        );
      if (source !== 'manual')
        required(proof, proofPath, '結匯水單或匯率證明說明');
    } else if (
      dateBasis === 'bot' ||
      dateBasis === 'bot-cash' ||
      dateBasis === 'bot-spot' ||
      dateBasis === 'central-bank'
    ) {
      if (reference && date > reference)
        issue(
          'error',
          'fx-reference',
          datePath,
          `無結匯憑證應使用奉派出差前一日的匯率（假日往前）；目前最晚為 ${reference}。`,
        );
      if (reference && date < reference) {
        if (!proof?.trim())
          issue(
            'error',
            'fx-holiday-proof-required',
            proofPath,
            `所選 ${date} 早於 ${reference}；請提供中間日期為臺灣銀行未報價日的官方依據，不能直接套用更早匯率。`,
          );
        else
          issue(
            'warning',
            'fx-holiday-proof',
            datePath,
            `所選 ${date} 早於 ${reference}，請確認所附依據足以證明中間日期為臺灣銀行未報價日。`,
          );
      }
      if (reference && reference > today)
        issue(
          'error',
          'fx-unpublished',
          datePath,
          '奉派出差的基準匯率日期尚未到來，不能以最近匯率代替。',
        );
    }
  };
  if (hasLivingDays)
    validateFx(
      draft.fx.rateDate,
      draft.fx.source,
      draft.fx.proofNote,
      'fx',
      draft.fx.manualBasis,
    );
  if (hasLivingDays && draft.fx.source === 'card')
    issue(
      'error',
      'living-card-fx',
      'fx.source',
      '生活費請使用符合日期規定的美元結匯證明或臺銀美元現金賣出匯率；信用卡實付請填在各筆費用。',
    );
  if (hasLivingDays && reference)
    issue(
      'info',
      'fx-baseline',
      'fx',
      `匯率以出差日期 ${fxDeparture} 為基準；銀行未報價日向前，依臺銀實際報價日確認。`,
    );

  const daily: DailyCalculation[] = [];
  const byId = new Map<string, DailyEntry>();
  for (const [index, day] of draft.days.entries()) {
    const path = `days.${index}`;
    const ordinal = civilDay(day.date);
    if (byId.has(day.id))
      issue(
        'error',
        'duplicate-day-id',
        path,
        '日期識別碼重複，請重新建立行程。',
      );
    byId.set(day.id, day);
    if (
      ordinal === null ||
      (index > 0 &&
        (civilDay(draft.days[index - 1].date) === null ||
          day.date !== addDays(draft.days[index - 1].date, 1)))
    )
      issue(
        'error',
        'day-sequence',
        `${path}.date`,
        '每日行程必須依當地日期連續排列，不能重複或跳日。',
      );
    // A private day has no monetary claim cells. Ignore stale allowance and
    // deduction input; its optional location and personal-travel label remain.
    if (day.kind === 'personal') {
      daily.push({
        id: day.id,
        date: day.date,
        eligible: false,
        percent: 0,
        grossUsd: '0',
        deductionUsd: '0',
        netUsd: '0',
        exactTwd: '0',
        formula: '',
        reason: '',
      });
      continue;
    }
    if (day.rateSource === 'manual')
      required(
        day.usdRateProof,
        path + '.usdRateProof',
        '手動日支額的官方依據',
      );
    required(day.location, `${path}.location`, `${day.date} 的國家及城市`);
    if (day.kind === 'flight' && !day.transit) {
      const endpoints = day.location.split(/\s*(?:→|－|—|->)\s*/);
      if (
        endpoints.length !== 2 ||
        endpoints.some((endpoint) => !endpoint.trim())
      )
        issue(
          'error',
          'transit-endpoints',
          `${path}.transit`,
          `${day.date} 在交通工具上歇夜，請分別填寫起點與迄點。`,
        );
    }
    if ((day.kind === 'flight' || day.kind === 'return') && day.transit) {
      required(day.transit.from, `${path}.transit.from`, `${day.date} 的起點`);
      required(day.transit.to, `${path}.transit.to`, `${day.date} 的迄點`);
      const expected = `${day.transit.from.trim()}→${day.transit.to.trim()}`;
      if (day.location !== expected)
        issue(
          'error',
          'transit-location',
          `${path}.location`,
          '起迄地點與表內路線不一致，請重新選取起點與迄點。',
        );
    }
    required(day.work, `${path}.work`, `${day.date} 的工作記要`);
    const rate = parse(
      day.usdRate,
      `${path}.usdRate`,
      `${day.date} 的生活費日支數額`,
    );
    if (day.date === draft.endDate && day.kind === 'official')
      issue(
        'error',
        'return-kind',
        `${path}.kind`,
        '行程最後一天是實際返國日，請改為返國日（生活費至多 30%）；私人行程請明確改為私人行程，不得以一般公差全額列計。',
      );
    const lodgingPercent =
      day.kind === 'return' || day.kind === 'flight' || day.lodgingProvided
        ? 70
        : 0;
    const mealPercent = day.mealsInFlight
      ? 0
      : (day.breakfast ? 4 : 0) + (day.lunch ? 8 : 0) + (day.dinner ? 8 : 0);
    const percent = 100 - lodgingPercent - mealPercent;
    const extra = parse(
      day.extraDeductionUsd,
      `${path}.extraDeductionUsd`,
      '額外扣除美元',
      true,
    );
    const gross = rate ? rate.percent(100 - lodgingPercent) : ZERO;
    const deduction =
      rate && extra ? rate.percent(mealPercent).plus(extra) : ZERO;
    let net = rate && extra ? gross.minus(deduction) : null;
    if (net && net.compare(ZERO) < 0) {
      issue(
        'error',
        'negative-living',
        `${path}.extraDeductionUsd`,
        '扣除額不能超過當日可支領生活費。',
      );
      net = null;
    }
    if (day.kind === 'return' && day.date !== draft.endDate)
      issue(
        'warning',
        'return-date',
        `${path}.kind`,
        '返國日標記與行程最後一天不同，請核對當地日期。',
      );
    const exact = net && fx ? net.times(fx) : null;
    daily.push({
      id: day.id,
      date: day.date,
      eligible: true,
      percent,
      grossUsd: rate ? gross.toString() : null,
      deductionUsd: rate && extra ? deduction.toString() : null,
      netUsd: net?.toString() ?? null,
      exactTwd: exact?.toString() ?? null,
      formula: rate
        ? `${rate.toString()} × ${100 - lodgingPercent}%${deduction.compare(ZERO) > 0 ? ` − ${deduction.toString()}` : ''} = ${net?.toString() ?? '待填'} US$`
        : '待填日支數額',
      reason: lodgingPercent
        ? '扣除住宿 70%'
        : mealPercent
          ? `扣除免費餐食 ${mealPercent}%`
          : '全額日支',
    });
  }
  if (
    start !== null &&
    end !== null &&
    (draft.days.length !== end - start + 1 ||
      draft.days[0]?.date !== draft.startDate ||
      draft.days.at(-1)?.date !== draft.endDate)
  )
    issue(
      'error',
      'days-mismatch',
      'days',
      '逐日行程須涵蓋完整出發與返國日期。',
    );

  const expenseResults: ExpenseCalculation[] = [];
  const expenseIds = new Set<string>();
  for (const [index, expense] of draft.expenses.entries()) {
    const path = `expenses.${index}`;
    let exact: Decimal | null;
    let formula = '';
    if (expenseIds.has(expense.id))
      issue(
        'error',
        'duplicate-expense-id',
        path,
        '費用識別碼重複，請重新建立該筆費用。',
      );
    expenseIds.add(expense.id);
    if (!categories.some(([category]) => category === expense.category))
      issue(
        'error',
        'expense-category',
        `${path}.category`,
        '請選擇有效費用類別。',
      );
    if (
      civilDay(expense.date) === null ||
      !draft.days.some((day) => day.date === expense.date)
    )
      issue(
        'error',
        'expense-date',
        `${path}.date`,
        '費用須指定到行程中的當地日期。',
      );
    const assignedDay = daily.find((day) => day.date === expense.date);
    if (assignedDay && !assignedDay.eligible)
      issue(
        'error',
        'expense-ineligible-day',
        `${path}.date`,
        '此費用列支日期為私人行程。費用日期是列支日，不是付款日；請核對正確列支日並排除私人費用，系統不會自行移除金額。',
      );
    if (expense.foreignTaxi && expense.category !== 'misc')
      issue(
        'error',
        'taxi-category',
        `${path}.category`,
        '國外計程車費請列入禮品交際及雜費。',
      );
    if (expense.payment === 'card') {
      const actual = parse(
        expense.cardTwd,
        `${path}.cardTwd`,
        '信用卡實際結算臺幣',
      );
      const fee = parse(
        expense.cardFeeTwd,
        `${path}.cardFeeTwd`,
        '信用卡國外交易手續費',
        true,
      );
      exact = actual && fee ? actual.plus(fee) : null;
      formula = `${actual?.toString() ?? '待填'} + ${fee?.toString() ?? '待填'} = ${exact?.toString() ?? '待填'} NT$`;
      if (fee && fee.compare(ZERO) > 0)
        issue(
          'warning',
          'card-fee-proof',
          path,
          '信用卡國外交易手續費須檢附信用卡帳單及支出證明單，並確認未重複列報。',
        );
    } else {
      const amount = parse(expense.amount, `${path}.amount`, '原幣金額');
      const currency = expense.currency.trim().toUpperCase();
      required(currency, `${path}.currency`, '幣別');
      const rate =
        currency === 'TWD' || currency === 'NTD'
          ? Decimal.parse('1')
          : parse(expense.fxRate, `${path}.fxRate`, '此筆費用匯率');
      if (rate && rate.compare(ZERO) <= 0)
        issue('error', 'zero-fx', `${path}.fxRate`, '匯率必須大於 0。');
      if (currency !== 'TWD' && currency !== 'NTD') {
        if (expense.fxSource === 'card')
          issue(
            'error',
            'cash-card-source',
            path + '.fxSource',
            '信用卡實付請選信用卡付款，勿把信用卡當成原幣換算匯率。',
          );
        if (
          expense.fxSource === 'bot-spot' &&
          (!expense.cashUnavailable || !expense.fxProofNote?.trim())
        )
          issue(
            'error',
            'spot-condition',
            path + '.fxSource',
            '無現金賣出報價才可採即期賣出；請確認並記錄官方依據。',
          );
        if (
          expense.fxSource === 'central-bank' &&
          (!expense.botUnavailable || !expense.fxProofNote?.trim())
        )
          issue(
            'error',
            'central-bank-condition',
            path + '.fxSource',
            '採央行交叉匯率前，請確認臺銀未提供該幣別賣出報價，並記錄官方交叉匯率算式。',
          );
        validateFx(
          expense.fxDate,
          expense.fxSource ?? 'manual',
          expense.fxProofNote ?? '',
          path,
          expense.manualBasis,
        );
      }
      exact = amount && rate ? amount.times(rate) : null;
      formula = `${amount?.toString() ?? '待填'} ${currency} × ${rate?.toString() ?? '待填'} = ${exact?.toString() ?? '待填'} NT$`;
    }
    expenseResults.push({
      id: expense.id,
      category: expense.category,
      exactTwd: exact?.toString() ?? null,
      formula,
    });
  }
  const resultCategories: CategoryCalculation[] = categories.map(
    ([category, label]) => {
      const values =
        category === 'living'
          ? daily.map((day) => day.exactTwd)
          : expenseResults
              .filter((expense) => expense.category === category)
              .map((expense) => expense.exactTwd);
      const exact = values.some((value) => value === null)
        ? null
        : values.reduce<Decimal>(
            (sum, value) => sum.plus(Decimal.parse(value!)),
            ZERO,
          );
      let twd: number | null = null;
      try {
        twd = exact?.round() ?? null;
      } catch {
        issue(
          'error',
          'amount-overflow',
          'expenses',
          '金額超出可安全處理範圍。',
        );
      }
      return { category, label, exactTwd: exact?.toString() ?? null, twd };
    },
  );
  let totalTwd = resultCategories.some((category) => category.twd === null)
    ? null
    : resultCategories.reduce((sum, category) => sum + category.twd!, 0);
  if (totalTwd !== null && !Number.isSafeInteger(totalTwd)) {
    totalTwd = null;
    issue('error', 'total-overflow', 'expenses', '總金額超出可安全處理範圍。');
  }
  const limit = draft.fundingLimit.trim()
    ? parse(draft.fundingLimit, 'fundingLimit', '本次申請金額上限')
    : null;
  if (limit && !/^\d+$/.test(draft.fundingLimit.trim()))
    issue(
      'error',
      'funding-integer',
      'fundingLimit',
      '申請金額上限請填整數臺幣。',
    );
  const claimTwd =
    totalTwd === null
      ? null
      : limit
        ? Math.min(totalTwd, limit.round())
        : totalTwd;
  if (claimTwd !== null && totalTwd !== null && claimTwd < totalTwd)
    issue(
      'info',
      'funding-limit',
      'fundingLimit',
      `計算旅費 ${totalTwd.toLocaleString('zh-TW')} 元，本次申請 ${claimTwd.toLocaleString('zh-TW')} 元。`,
    );
  const misc = resultCategories.find(
    (category) => category.category === 'misc',
  );
  const claimDayCount = draft.days.filter(
    (day) => day.kind !== 'personal',
  ).length;
  if (
    misc?.exactTwd &&
    Decimal.parse(misc.exactTwd).compare(
      Decimal.parse(String(claimDayCount * 1100)),
    ) > 0
  )
    issue(
      'error',
      'misc-cap',
      'expenses',
      `禮品交際及雜費超過一般個人出差 ${claimDayCount} 日 × 1,100 元的合計上限；率團或租車例外須另行核定。`,
    );
  if (draft.expenses.some((expense) => expense.category === 'insurance')) {
    const coverage = parse(
      draft.insurance.coverageAmount,
      'insurance.coverageAmount',
      '綜合保險額度',
    );
    const premiumCap = parse(
      draft.insurance.premiumCap,
      'insurance.premiumCap',
      '共同供應契約保費上限',
    );
    if (coverage && coverage.compare(Decimal.parse('4000000')) > 0)
      issue(
        'error',
        'insurance-coverage',
        'insurance.coverageAmount',
        '綜合保險額度以 400 萬元為上限，請確認可報支部分。',
      );
    if (!draft.insurance.capConfirmed)
      issue(
        'error',
        'insurance-cap-unknown',
        'insurance.capConfirmed',
        '請查核適用共同供應契約的保費上限，不可把自行輸入的保費當作上限。',
      );
    const premium = resultCategories.find(
      (category) => category.category === 'insurance',
    )?.exactTwd;
    if (premiumCap && premium && Decimal.parse(premium).compare(premiumCap) > 0)
      issue(
        'error',
        'insurance-premium',
        'insurance.premiumCap',
        '保險費超過適用共同供應契約的保費上限，請更正可報支金額。',
      );
  }
  if (
    draft.expenses.some((expense) => expense.category === 'flight') &&
    !draft.cabin.standard
  ) {
    const seniorEligible =
      draft.cabin.seniorEligible && draft.template === 'general';
    const economyOnlyWithProof =
      draft.economyClaimOnly === true &&
      Boolean(draft.airfareExplanation?.trim()) &&
      draft.checkedDocuments?.['economy-proof'] === true;
    if (seniorEligible)
      issue(
        'warning',
        'cabin',
        'cabin',
        '非基礎座艙且符合職等條件，請完成原表附表及檢附資格、航程證明。',
      );
    else if (economyOnlyWithProof)
      issue(
        'warning',
        'cabin-economy-only',
        'cabin',
        '實際搭乘非基礎座艙，本案已確認僅申請經濟艙票價並附說明及票價證明；請核對每筆機票可報支金額，保留實際艙等紀錄。',
      );
    else
      issue(
        'error',
        'cabin',
        'cabin',
        '非基礎座艙須確認僅申請經濟艙票價，填妥升等／繞道說明並檢附經濟艙票價證明，才可依可報支金額列計。',
      );
  }
  const funding = draft.funding;
  if (funding) {
    if (
      funding.type === 'nstc' &&
      !['paper', 'speaker', 'chair', 'approved'].includes(funding.activityRole)
    )
      issue(
        'error',
        'nstc-role',
        'funding.activityRole',
        '國科會出席國際會議須發表論文、專題演講、擔任主持人或取得個案同意。',
      );
    if (
      funding.type === 'nstc' &&
      funding.activityRole === 'approved' &&
      !funding.priorApproval
    )
      issue(
        'error',
        'activity-approval',
        'funding.priorApproval',
        '個案出席須確認已取得同意文件。',
      );
    if (
      funding.type === 'other' &&
      !funding.priorApproval &&
      !funding.approvedItems
    )
      issue(
        'error',
        'funding-approval',
        'funding.priorApproval',
        '請確認出國簽准或委託／補助單位已核定出國項目明細。',
      );
    if (
      draft.expenses.some(
        (expense) =>
          expense.category === 'registration' &&
          (funding.type === 'other' || expense.administrativeType === 'other'),
      ) &&
      !funding.priorApproval
    )
      issue(
        'error',
        'registration-approval',
        'funding.priorApproval',
        '行政費須於出國前完成核准，請檢附簽文。',
      );
    if (funding.shared && !funding.sharingApproved)
      issue(
        'error',
        'sharing-approval',
        'funding.sharingApproved',
        '有其他經費分攤時，請先完成校內簽准並檢附支出科目分攤表。',
      );
    if (funding.planChanged && !funding.changeApproved)
      issue(
        'error',
        'plan-change',
        'funding.changeApproved',
        '行程或出國種類有變更，請先完成計畫變更核准。',
      );
  }
  if (draft.dischargeDate) {
    if (civilDay(draft.dischargeDate) === null)
      issue('error', 'discharge-date', 'dischargeDate', '請填寫有效銷差日期。');
    else {
      const due = addDays(draft.dischargeDate, 45);
      issue(
        today > due ? 'warning' : 'info',
        'submission-deadline',
        'dischargeDate',
        `銷差後 45 日的送件提醒日為 ${due}；起算與末日順延請依主計室核定。`,
      );
    }
  }
  let receiptCount: number | null = null;
  const receiptCountInput = draft.receiptCount.trim();
  if (
    receiptCountInput &&
    (!/^\d+$/.test(receiptCountInput) ||
      !Number.isSafeInteger(Number(receiptCountInput)))
  )
    issue(
      'error',
      'receipt-count',
      'receiptCount',
      '附件單據張數須為有效的非負整數；尚未整理完成可先留空。',
    );
  else if (receiptCountInput) receiptCount = Number(receiptCountInput);
  if (
    receiptCount === 0 &&
    (draft.expenses.some((expense) => expense.receipt.trim()) ||
      expenseResults.some(
        (expense) =>
          expense.exactTwd !== null &&
          Decimal.parse(expense.exactTwd).compare(ZERO) > 0,
      ))
  )
    issue(
      'error',
      'receipt-count-zero',
      'receiptCount',
      '已列報檢據費用或填寫單據號數，附件張數不可為 0；尚未整理完成可先留空。',
    );

  const groups = draft.groups.length ? draft.groups : autoGroupDays(draft.days);
  const flattened = groups.flatMap((group) => group.dayIds);
  if (
    flattened.length !== draft.days.length ||
    flattened.some((id, index) => id !== draft.days[index]?.id)
  )
    issue(
      'error',
      'groups-coverage',
      'groups',
      '日期分欄須依序涵蓋每一天，不能漏日或重複。',
    );
  const maximum = 12;
  if (groups.length > maximum)
    issue(
      'error',
      'print-columns',
      'groups',
      `目前 ${groups.length} 個日期欄，超過原表單頁可容納的 ${maximum} 欄。請合併相同條件的連續日期。`,
    );
  const groupResults: GroupCalculation[] = groups.flatMap((group) => {
    const entries = group.dayIds.map((id) => byId.get(id));
    if (entries.some((entry) => !entry) || !entries.length) {
      issue(
        'error',
        'group-missing-day',
        'groups',
        '日期區段含不存在的行程，請重新分組。',
      );
      return [];
    }
    const actual = entries as DailyEntry[];
    if (!canGroupDays(actual))
      issue(
        'error',
        'group-incompatible',
        'groups',
        '同一日期欄的地點、工作、日支額與供餐住宿條件必須相同。',
      );
    const values = actual.map((day) =>
      daily.find((result) => result.id === day.id)!,
    );
    const sum = (key: 'grossUsd' | 'netUsd' | 'deductionUsd') =>
      values.some((value) => value[key] === null)
        ? null
        : values
            .reduce((acc, value) => acc.plus(Decimal.parse(value[key]!)), ZERO)
            .toString();
    const first = actual[0],
      last = actual.at(-1)!;
    const sameMonth = first.date.slice(0, 7) === last.date.slice(0, 7);
    const short = (date: string) =>
      `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    const monthLabel = sameMonth
      ? String(Number(first.date.slice(5, 7)))
      : `${Number(first.date.slice(5, 7))}～${Number(last.date.slice(5, 7))}`;
    const dayLabel =
      actual.length === 1
        ? String(Number(first.date.slice(8, 10)))
        : sameMonth
          ? `${Number(first.date.slice(8, 10))}～${Number(last.date.slice(8, 10))}`
          : `${short(first.date)}～${short(last.date)}`;
    const personal = actual.every((day) => day.kind === 'personal');
    const expenses: Partial<Record<Category, string>> = {};
    for (const [category] of categories) {
      if (personal || category === 'living') continue;
      const rows = draft.expenses.filter(
        (expense) =>
          expense.category === category &&
          actual.some((day) => day.date === expense.date),
      );
      if (rows.length)
        expenses[category] = rows
          .map((expense) =>
            expense.payment === 'card'
              ? `NT$${expense.cardTwd}${expense.cardFeeTwd && expense.cardFeeTwd !== '0' ? `+${expense.cardFeeTwd}` : ''}`
              : `${expense.currency.toUpperCase() === 'TWD' ? 'NT$' : expense.currency.toUpperCase() === 'USD' ? 'US$' : `${expense.currency} `}${expense.amount}`,
          )
          .join('\n');
    }
    const grossUsd = sum('grossUsd');
    const netUsd = sum('netUsd');
    const deductionUsd = sum('deductionUsd');
    const grossPercent = values[0].eligible
      ? first.kind === 'return' ||
        first.kind === 'flight' ||
        first.lodgingProvided
        ? 30
        : 100
      : 0;
    const grossText =
      actual.length === 1
        ? grossPercent === 100
          ? first.usdRate
          : `${first.usdRate}×${grossPercent}%=${grossUsd ?? '待填'}`
        : `${first.usdRate}${grossPercent === 100 ? '' : `×${grossPercent}%`}×${actual.length}=${grossUsd ?? '待填'}`;
    return [
      {
        id: group.id,
        dayIds: group.dayIds,
        startDate: first.date,
        endDate: last.date,
        monthLabel,
        dayLabel,
        dateLabel:
          actual.length === 1
            ? short(first.date)
            : `${short(first.date)}～${short(last.date)}`,
        location: first.location,
        work: personal ? '個人行程' : first.work,
        grossUsd,
        netUsd,
        deductionUsd,
        livingText: personal ? '' : grossText,
        deductionText: personal
          ? ''
          : deductionUsd === '0' &&
              !actual.some(
                (d) => d.breakfast || d.lunch || d.dinner || d.mealsInFlight,
              )
            ? '無免費供餐'
            : deductionUsd === '0' && actual.every((d) => d.mealsInFlight)
              ? '航程供餐不扣'
              : `US$${deductionUsd ?? '待填'}`,
        expenses,
        receipts: personal
          ? ''
          : [
              ...new Set(
                draft.expenses
                  .filter((expense) =>
                    actual.some((day) => day.date === expense.date),
                  )
                  .map((expense) => expense.receipt.trim())
                  .filter(Boolean),
              ),
            ].join('、'),
      },
    ];
  });
  return {
    daily,
    expenses: expenseResults,
    groups: groupResults,
    categories: resultCategories,
    totalTwd,
    claimTwd,
    receiptCount,
    dayCount: draft.days.length,
    fxReferenceDate: reference,
    issues,
    canExport:
      totalTwd !== null && !issues.some((item) => item.severity === 'error'),
    rounding: 'category-half-up',
  };
}

export function createEmptyDraft(): Draft {
  return {
    version: 1,
    template: 'general',
    person: { name: '', identifier: '', title: '', grade: '' },
    purpose: '',
    budgetItem: '國外旅費',
    voucherNumber: '',
    approvedStart: '',
    approvedEnd: '',
    dischargeDate: '',
    startDate: '',
    endDate: '',
    receiptCount: '',
    fundingLimit: '',
    fx: { rate: '', rateDate: '', source: 'bot', proofNote: '' },
    days: [],
    expenses: [],
    groups: [],
    notes: '',
    insurance: { coverageAmount: '', premiumCap: '', capConfirmed: false },
    cabin: { standard: true, seniorEligible: false },
    funding: {
      type: 'other',
      activityRole: 'paper',
      priorApproval: false,
      approvedItems: false,
      shared: false,
      sharingApproved: false,
      planChanged: false,
      changeApproved: false,
    },
  };
}
export function createSampleDraft(): Draft {
  const draft = createEmptyDraft();
  Object.assign(draft, {
    purpose: '出席國際學術會議並發表論文（匿名範例）',
    approvedStart: '2026-07-13',
    approvedEnd: '2026-07-17',
    startDate: '2026-07-13',
    endDate: '2026-07-17',
    receiptCount: '6',
    fundingLimit: '70000',
  });
  draft.person = {
    name: '範例出差人',
    identifier: '000000',
    title: '研究人員',
    grade: '',
  };
  draft.fx = {
    rate: '29.995',
    rateDate: '2026-07-10',
    source: 'manual',
    proofNote: '沿用原表的示例匯率，非 2026 年實際歷史報價',
  };
  draft.days = makeDays(draft.startDate, draft.endDate, {
    usdRate: '268',
    location: '美國・舊金山',
    work: '出席會議並發表論文',
  });
  draft.days[0].kind = 'flight';
  draft.days[0].location = '臺北－美國舊金山';
  draft.days[0].work = '飛機上歇夜';
  draft.days[1].work = '抵達當地';
  draft.days[2].lunch = true;
  draft.days[3].lunch = true;
  draft.days[4].location = '美國舊金山－臺北';
  draft.days[4].work = '返國';
  const expense = (
    id: string,
    category: Category,
    amount: string,
    currency = 'TWD',
  ): Draft['expenses'][number] => ({
    id,
    date: '2026-07-13',
    category,
    description: CATEGORY_LABELS[category],
    amount,
    currency,
    fxRate: currency === 'USD' ? '29.995' : '1',
    payment: 'cash',
    cardTwd: '',
    cardFeeTwd: '',
    receipt: id.slice(-1),
    foreignTaxi: false,
    fxDate: '2026-07-10',
    fxSource: 'manual',
    fxProofNote: '沿用原表示例值，非該日實際匯率',
  });
  draft.expenses = [
    expense('expense-1', 'flight', '39000'),
    expense('expense-2', 'insurance', '608'),
    expense('expense-3', 'registration', '350', 'USD'),
  ];
  draft.insurance = {
    coverageAmount: '4000000',
    premiumCap: '608',
    capConfirmed: true,
  };
  draft.funding!.priorApproval = true;
  draft.groups = autoGroupDays(draft.days);
  draft.notes =
    '此為原表匿名範例，用於核對計算；保險上限及匯率均非目前案件資料。';
  return draft;
}
export const sampleDraft = createSampleDraft();
