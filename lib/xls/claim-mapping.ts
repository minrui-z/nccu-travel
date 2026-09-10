import type { Draft, Calculation, Issue } from '../claim/types';
import { studentFundingNote } from '../claim/student-funding-note';
import type {
  XlsChanges,
  XlsValue,
  RichTextValue,
  RichTextRun,
} from './xls-exporter';
import type {
  TemplateManifest,
  TemplateCell,
  TemplateSheet,
} from './template-manifest';

const labels: Record<string, string> = {
  name: '姓名',
  identity: '證號',
  title: '職稱',
  grade: '職等',
  reason: '出差事由',
  period: '出差期間',
  total: '總計',
  notes: '備註',
  month: '月份',
  day: '日期',
  location: '起訖地點',
  work: '工作記要',
  flight: '飛機費',
  ship: '船舶費',
  land: '陸運費',
  living: '生活費',
  handling: '手續費',
  insurance: '保險費',
  registration: '行政費',
  misc: '禮品交際及雜費',
  deduction: '扣除金額',
  receipt: '單據號數',
};
function sourceCell(m: TemplateManifest, address: string): TemplateCell {
  return m.sheets[0].cells.find((c) => c.address === address)!;
}
function preserveRuns(source: TemplateCell, text: string): RichTextValue {
  return {
    text,
    runs: source.runs
      .filter((r) => r.start <= text.length)
      .map((r) => ({ ...r })),
  };
}
const money = (value: number) =>
  value.toLocaleString('en-US', { maximumFractionDigits: 0 });
function dateLabel(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '____年__月__日';
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}
/** Choose an equivalent generated display; never shorten user-entered content. */
function generatedText(
  manifest: TemplateManifest,
  address: string,
  options: string[],
  autoFit = false,
): string {
  const cell = sourceCell(manifest, address),
    sheet = manifest.sheets[0];
  const fits = (
    text: string,
    layout: TemplateManifest,
    target: TemplateCell,
  ) => {
    const m = estimateCellCapacity(text, target, sheet, layout);
    return (
      m.estimatedLines <= m.availableLines &&
      (m.wrap
        ? m.estimatedWidthPt <= m.widthPt
        : !text.includes('\n') &&
          (m.shrinkToFit
            ? m.effectiveFontSize >= 8
            : m.estimatedWidthPt <= m.widthPt))
    );
  };
  // Choose the complete expression whenever the shared text fitter can keep it
  // at a readable size. Do not abbreviate before that fitter gets a chance.
  const smallest: TemplateManifest = {
    ...manifest,
    // Keep the normal font unchanged: it defines BIFF column-width units.
    fonts: [
      ...manifest.fonts,
      {
        ...manifest.fonts[manifest.styles[cell.styleIndex].fontIndex],
        size: 8,
      },
    ],
    styles: [
      ...manifest.styles,
      {
        ...manifest.styles[cell.styleIndex],
        fontIndex: manifest.fonts.length,
        wrap: true,
        shrinkToFit: false,
      },
    ],
  };
  return (
    options.find((text) => {
      const m = estimateCellCapacity(text, cell, sheet, manifest);
      const originalFit = m.wrap
        ? m.estimatedLines <= m.availableLines
        : m.shrinkToFit
          ? m.effectiveFontSize >= 8
          : m.estimatedWidthPt <= m.widthPt;
      return (
        (autoFit ? fits(text, manifest, cell) : originalFit) ||
        (autoFit &&
          fits(text, smallest, {
            ...cell,
            styleIndex: smallest.styles.length - 1,
          }))
      );
    }) ?? options[0]
  );
}
/** Monetary calculations are never recomputed here. This maps the reviewed result to the original form. */
export function buildClaimChanges(
  draft: Draft,
  calculation: Calculation,
  manifest: TemplateManifest,
): XlsChanges {
  if (draft.template !== manifest.kind)
    throw new Error('出差人身分與表單版本不一致。');
  if (calculation.groups.length > manifest.segmentCount)
    throw new Error(
      `日期區段有 ${calculation.groups.length} 欄，請載入相同欄數的表單。`,
    );
  const field = (name: string): string => {
    const value = manifest.fields[name];
    if (typeof value !== 'string') throw new Error(`模板欄位 ${name} 缺失。`);
    return value;
  };
  const amountDigits = manifest.fields.amountDigits;
  if (!Array.isArray(amountDigits)) throw new Error('模板金額欄缺失。');
  const f = {
      name: field('name'),
      identity: field('identity'),
      title: field('title'),
      grade: manifest.fields.grade ? field('grade') : null,
      reason: field('reason'),
      period: field('period'),
      total: field('total'),
      notes: field('notes'),
      amountDigits,
    },
    cells: Record<string, XlsValue> = {};
  cells[f.name] = draft.person.name;
  cells[f.identity] = draft.person.identifier;
  cells[f.title] = draft.person.title;
  if (f.grade) cells[f.grade] = draft.person.grade;
  cells.A7 = draft.voucherNumber || null;
  cells.B7 = draft.budgetItem || null;
  cells[f.reason] = draft.purpose;
  const period = `西元${dateLabel(draft.startDate)}起${dateLabel(draft.endDate)}止共計${calculation.dayCount}日 附單據${calculation.receiptCount ?? '__'}張`;
  cells[f.period] = preserveRuns(sourceCell(manifest, f.period), period);
  const claim = calculation.claimTwd;
  if (
    claim !== null &&
    (!Number.isSafeInteger(claim) ||
      claim < 0 ||
      String(claim).length > f.amountDigits.length)
  )
    throw new Error(
      `本次申請金額超過原表 ${f.amountDigits.length} 位金額欄，請核對金額。`,
    );
  const digits =
    claim === null ? '' : String(claim).padStart(f.amountDigits.length, ' ');
  f.amountDigits.forEach((address, i) => {
    cells[address] = digits[i] && digits[i] !== ' ' ? Number(digits[i]) : null;
  });
  for (const segment of manifest.segments)
    for (const a of Object.values(segment.fields)) cells[a] = null;
  const sharedWork = new Map<string, Array<{ date: string; work: string }>>();
  const generatedNotes = new Set<string>();
  const livingCalculations = new Set<string>();
  let abbreviatedUsdAmount = false;
  calculation.groups.forEach((group, i) => {
    const sf = manifest.segments[i].fields;
    cells[sf.month] = group.monthLabel;
    cells[sf.day] = group.dayLabel;
    const personal = group.dayIds.every(
      (id) => draft.days.find((day) => day.id === id)?.kind === 'personal',
    );
    cells[sf.location] = group.location || null;
    const work = sharedWork.get(sf.work) ?? [];
    work.push({
      date: group.dateLabel,
      work: personal ? '個人行程' : group.work,
    });
    sharedWork.set(sf.work, work);
    // Private columns still identify the itinerary, while all claim cells stay
    // native blanks even if a legacy draft contains stale financial values.
    if (personal) return;
    const livingOptions = [group.livingText];
    if (group.grossUsd !== null) livingOptions.push(group.grossUsd);
    const livingText = generatedText(manifest, sf.living, livingOptions, true);
    cells[sf.living] = livingText;
    if (livingText !== group.livingText && livingText === group.grossUsd) {
      livingCalculations.add(group.livingText);
    }
    const deductionOptions =
      group.deductionText === '無免費供餐'
        ? ['無免費供餐', '無免費餐', '無']
        : group.deductionText === '航程供餐不扣'
          ? ['航程供餐不扣', '航']
          : group.deductionUsd !== null &&
              group.deductionText === `US$${group.deductionUsd}`
            ? [group.deductionText, group.deductionUsd]
            : [group.deductionText];
    const deductionText = generatedText(
      manifest,
      sf.deduction,
      deductionOptions,
    );
    cells[sf.deduction] = deductionText;
    if (deductionText === '無')
      generatedNotes.add('扣除欄「無」表示無免費供餐。');
    else if (deductionText === '航')
      generatedNotes.add('扣除欄「航」表示航程供餐不扣。');
    else if (
      deductionText !== group.deductionText &&
      deductionText === group.deductionUsd
    )
      abbreviatedUsdAmount = true;
    cells[sf.receipt] = group.receipts || null;
    for (const key of [
      'flight',
      'ship',
      'land',
      'handling',
      'insurance',
      'registration',
      'misc',
    ] as const) {
      const dates = new Set(
        group.dayIds.map((id) => draft.days.find((day) => day.id === id)?.date),
      );
      const expenses = draft.expenses.filter(
        (expense) => expense.category === key && dates.has(expense.date),
      );
      const references: string[] = [];
      const options = expenses.map((expense) => {
        if (expense.payment === 'card') {
          const value = `NT$${expense.cardTwd}${expense.cardFeeTwd && expense.cardFeeTwd !== '0' ? `+${expense.cardFeeTwd}` : ''}`;
          return [value, value, value, value];
        }
        const currency = expense.currency.trim().toUpperCase();
        if (currency === 'TWD' || currency === 'NTD') {
          const value = `NT$${expense.amount}`;
          return [value, value, value, value];
        }
        const amount = `${currency === 'USD' ? 'US$' : currency}${expense.amount}`;
        const conversion = `${amount}×${expense.fxRate || '待填'}`;
        const exact = calculation.expenses.find(
          (result) => result.id === expense.id,
        )?.exactTwd;
        const formula = `${conversion}=NT$${exact ?? '待填'}`;
        const expenseCell = sourceCell(manifest, sf[key]);
        const singleLine = {
          ...manifest,
          styles: [
            ...manifest.styles,
            {
              ...manifest.styles[expenseCell.styleIndex],
              wrap: false,
              shrinkToFit: false,
            },
          ],
        };
        const width = estimateCellCapacity(
          formula,
          {
            ...expenseCell,
            styleIndex: singleLine.styles.length - 1,
          },
          manifest.sheets[0],
          singleLine,
        );
        // Excel's automatic word breaks differ from character-width estimates.
        // Give the result its own line when the expression cannot be one line.
        const displayFormula =
          width.estimatedWidthPt <= width.widthPt
            ? formula
            : `${conversion}\n=NT$${exact ?? '待填'}`;
        const reference = draft.expenses.indexOf(expense) + 1;
        const date = `${Number(expense.date.slice(5, 7))}/${Number(expense.date.slice(8, 10))}`;
        references.push(`[${reference}]${date}${labels[key]}：${formula}。`);
        generatedNotes.add('費用格「×」後為各筆外幣折合臺幣匯率。');
        return [
          displayFormula,
          conversion,
          `${amount}[${reference}]`,
          `見[${reference}]`,
        ];
      });
      const displays = [
        options.map((option) => option[0]).join('\n'),
        options.map((option) => option[1]).join('\n'),
        options.map((option) => option[2]).join('\n'),
        options.map((option) => option[3]).join('、'),
      ];
      const display = expenses.length
        ? generatedText(manifest, sf[key], displays, true)
        : null;
      cells[sf[key]] = display;
      if (
        (display === displays[2] || display === displays[3]) &&
        references.length
      ) {
        for (const reference of references) generatedNotes.add(reference);
      }
    }
  });
  for (const [address, items] of sharedWork) {
    cells[address] = items.every((i) => i.work === items[0].work)
      ? items[0].work
      : items.map((item) => `${item.date}：${item.work}`).join('；');
  }
  cells[f.total] =
    calculation.totalTwd === null
      ? null
      : `NT$${money(calculation.totalTwd)}${calculation.daily.some((day) => day.eligible) ? `（生活費美元匯率${draft.fx.rate || '未填'}）` : ''}${claim !== null && claim < calculation.totalTwd ? `，僅申請NT$${money(claim)}` : ''}`;
  const originalNotes = sourceCell(manifest, f.notes),
    base = String(originalNotes.value || '');
  let originalIndex = 0;
  const checked = base.replace(/是□\s*否□/g, (match) => {
    const yes =
      originalIndex++ === 0 ? draft.cabin.standard : draft.cabin.seniorEligible;
    return yes ? match.replace('是□', '是☑') : match.replace('否□', '否☑');
  });
  const userNotes = draft.notes.trim();
  if (livingCalculations.size)
    generatedNotes.add(
      `生活費（美元）：${[...livingCalculations].join('；')}。`,
    );
  if (abbreviatedUsdAmount)
    generatedNotes.add('生活費與扣除金額均為美元（US$）。');
  const appendedNotes = [
    ...generatedNotes,
    studentFundingNote(draft, calculation),
    userNotes,
  ]
    .filter(Boolean)
    .join(' ');
  const text = checked + (checked && appendedNotes ? '\n' : '') + appendedNotes;
  const runs: RichTextRun[] = originalNotes.runs.map((r) => ({ ...r }));
  if (appendedNotes && checked) {
    const start = checked.length + 1,
      fontIndex = manifest.styles[originalNotes.styleIndex].fontIndex;
    if (!runs.length || runs.at(-1)!.start < start)
      runs.push({ start, fontIndex });
  }
  cells[f.notes] = text ? { text, runs } : null;
  return { [manifest.sheetName]: cells };
}

export interface CapacityIssue extends Issue {
  sheet: string;
  cell: string;
  label: string;
  /** Editable semantic field; cell coordinates remain available for export QA. */
  fieldKey: string;
  segmentIndex?: number;
  segmentIndexes?: number[];
  relatedFields?: Array<{ path: string; label: string }>;
  estimatedLines: number;
  availableLines: number;
}
export interface CellCapacity {
  widthPt: number;
  heightPt: number;
  estimatedWidthPt: number;
  estimatedLines: number;
  availableLines: number;
  fontSize: number;
  wrap: boolean;
  shrinkToFit: boolean;
  effectiveFontSize: number;
}
function glyphWidth(char: string, fontSize: number, bold: boolean): number {
  const cp = char.codePointAt(0)!;
  const units = /\s/u.test(char)
    ? 0.28
    : cp > 0x2e7f || cp >= 0x2600
      ? 1
      : /[ilI.,'`|!:;]/.test(char)
        ? 0.3
        : /[mwMW@%]/.test(char)
          ? 0.82
          : /[A-Z0-9]/.test(char)
            ? 0.56
            : 0.5;
  return units * fontSize * (bold ? 1.02 : 1);
}
function cellGeometry(
  sheet: TemplateSheet,
  cell: TemplateCell,
  manifest: TemplateManifest,
) {
  const merge = sheet.merges.find(
    (m) =>
      m.r1 <= cell.row &&
      m.r2 >= cell.row &&
      m.c1 <= cell.col &&
      m.c2 >= cell.col,
  );
  const r1 = merge?.r1 ?? cell.row,
    r2 = merge?.r2 ?? cell.row,
    c1 = merge?.c1 ?? cell.col,
    c2 = merge?.c2 ?? cell.col;
  // BIFF column width is in 1/256 of the normal style's maximum digit width.
  // The supplied CJK 12pt normal font has a half-em digit; measure unscaled
  // geometry because fit-to-page scales both the cell and its font together.
  const digitPt = manifest.fonts[0].size * 0.5;
  return {
    widthPt:
      sheet.columnWidths
        .slice(c1, c2 + 1)
        .reduce((s, n) => s + (n / 256) * digitPt, 0) - 4,
    heightPt: sheet.rowHeights.slice(r1, r2 + 1).reduce((s, n) => s + n, 0) - 2,
  };
}
/** Conservative geometry estimate, not a claim to emulate Excel's proprietary font renderer. */
export function estimateCellCapacity(
  value: XlsValue,
  cell: TemplateCell,
  sheet: TemplateSheet,
  manifest: TemplateManifest,
): CellCapacity {
  const style = manifest.styles[cell.styleIndex],
    font = manifest.fonts[style.fontIndex];
  const text =
    value === null
      ? ''
      : typeof value === 'object'
        ? value.text
        : String(value);
  const runs =
    typeof value === 'object' && value !== null ? (value.runs ?? []) : [];
  const { widthPt, heightPt } = cellGeometry(sheet, cell, manifest);
  let fontSize = font.size,
    width = 0,
    maxWidth = 0,
    lines = 1,
    pos = 0,
    runIndex = -1;
  for (const ch of text) {
    while (runIndex + 1 < runs.length && runs[runIndex + 1].start <= pos)
      runIndex++;
    const active =
      runIndex >= 0 ? manifest.fonts[runs[runIndex].fontIndex] : font;
    fontSize = Math.max(fontSize, active?.size ?? font.size);
    if (ch === '\n') {
      maxWidth = Math.max(maxWidth, width);
      width = 0;
      lines++;
      pos += ch.length;
      continue;
    }
    const w = glyphWidth(
      ch,
      active?.size ?? font.size,
      active?.bold ?? font.bold,
    );
    if (style.wrap && width > 0 && width + w > widthPt) {
      maxWidth = Math.max(maxWidth, width);
      width = 0;
      lines++;
    }
    width += w;
    pos += ch.length;
  }
  maxWidth = Math.max(maxWidth, width);
  const effectiveFontSize =
    !style.wrap && style.shrinkToFit && maxWidth > widthPt
      ? (fontSize * widthPt) / maxWidth
      : fontSize;
  return {
    widthPt,
    heightPt,
    estimatedWidthPt: maxWidth,
    estimatedLines: lines,
    availableLines: Math.max(0, Math.floor(heightPt / (fontSize * 1.15))),
    fontSize,
    wrap: style.wrap,
    shrinkToFit: style.shrinkToFit,
    effectiveFontSize,
  };
}
function capacityField(
  manifest: TemplateManifest,
  address: string,
): {
  label: string;
  fieldKey: string;
  segmentIndex?: number;
  segmentIndexes?: number[];
} {
  if (address === 'A7') return { label: '憑證編號', fieldKey: 'voucherNumber' };
  if (address === 'B7') return { label: '預算科目', fieldKey: 'budgetItem' };
  if (
    Array.isArray(manifest.fields.amountDigits) &&
    manifest.fields.amountDigits.includes(address)
  )
    return { label: '申請金額', fieldKey: 'total' };
  for (const [key, a] of Object.entries(manifest.fields))
    if (a === address)
      return { label: labels[key] ?? '表格文字', fieldKey: key };
  for (const [segmentIndex, seg] of manifest.segments.entries())
    for (const [key, a] of Object.entries(seg.fields))
      if (a === address)
        return {
          label: labels[key] ?? '表格文字',
          fieldKey: key,
          segmentIndex,
          segmentIndexes: manifest.segments.flatMap((candidate, index) =>
            candidate.fields[key] === address ? [index] : [],
          ),
        };
  return { label: '表格文字', fieldKey: 'notes' };
}
/** Blocks overflow; never truncates values or changes the original fonts, wrapping or row height. */
export function validateClaimCapacity(
  manifest: TemplateManifest,
  changes: XlsChanges,
): CapacityIssue[] {
  const issues: CapacityIssue[] = [];
  for (const [name, values] of Object.entries(changes)) {
    const sheet = manifest.sheets.find((s) => s.name === name);
    if (!sheet) continue;
    for (const [address, value] of Object.entries(values)) {
      if (value === null || value === '') continue;
      const cell = sheet.cells.find((c) => c.address === address);
      if (!cell) continue;
      const text = typeof value === 'object' ? value.text : String(value),
        measure = estimateCellCapacity(value, cell, sheet, manifest),
        field = capacityField(manifest, address);
      const overLong = text.length > manifest.limits.maxTextLength;
      const noWrapNewline = !measure.wrap && text.includes('\n');
      const overWidth =
        !measure.wrap &&
        measure.estimatedWidthPt > measure.widthPt &&
        (measure.shrinkToFit ? measure.effectiveFontSize < 8 : true);
      const overHeight =
        measure.wrap && measure.estimatedLines > measure.availableLines;
      if (overLong || noWrapNewline || overWidth || overHeight) {
        const reason = overLong
          ? '文字超過 2048 字元'
          : noWrapNewline
            ? '原欄位未設定換行，不能放入多行文字'
            : overHeight
              ? '文字行數超過原表列高'
              : measure.shrinkToFit
                ? '文字需縮到 8pt 以下才能容納'
                : '文字超過原表欄寬';
        issues.push({
          code: 'print-capacity',
          severity: 'error',
          path: `print.${name}.${address}`,
          sheet: name,
          cell: address,
          ...field,
          message: `${field.label}${reason}；請精簡內容${cell.row >= 10 && cell.row <= 23 ? '或調整日期分欄' : ''}。`,
          estimatedLines: measure.estimatedLines,
          availableLines: measure.availableLines,
        });
      }
    }
  }
  return issues;
}
