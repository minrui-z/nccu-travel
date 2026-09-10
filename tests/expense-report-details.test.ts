import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays,
  calculateClaim,
  createSampleDraft,
  makeDays,
} from '../lib/claim/claim-engine';
import type { Category, Draft, Expense, Template } from '../lib/claim/types';
import { buildClaimChanges } from '../lib/xls/claim-mapping';
import { fitClaimText } from '../lib/xls/text-fitting';
import type { TemplateManifest } from '../lib/xls/template-manifest';
import type { XlsValue } from '../lib/xls/xls-exporter';

const kinds = ['general', 'student'] as const;
const rateLegend = '費用格「×」後為各筆外幣折合臺幣匯率。';
const cellText = (value: XlsValue) =>
  value && typeof value === 'object' ? value.text : String(value ?? '');
const manifest = (kind: Template, count = 1) =>
  JSON.parse(
    readFileSync(
      new URL(`../public/templates/${kind}-${count}.json`, import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;

function draftFor(kind: Template, count = 1): Draft {
  const draft = createSampleDraft();
  draft.template = kind;
  draft.purpose = '會議';
  draft.notes = '';
  draft.expenses = [];
  draft.receiptCount = '';
  draft.fundingLimit = '';
  draft.startDate = draft.approvedStart = '2026-07-13';
  draft.endDate = draft.approvedEnd = addDays(draft.startDate, count - 1);
  draft.days = makeDays(draft.startDate, draft.endDate, {
    location: '城市',
    work: '會議',
    usdRate: '100',
  });
  draft.groups = draft.days.map((day) => ({
    id: `g-${day.id}`,
    dayIds: [day.id],
  }));
  return draft;
}

function expenseFor(draft: Draft, patch: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-a',
    date: draft.days[0].date,
    category: 'registration',
    description: '匿名費用',
    amount: '350',
    currency: 'USD',
    fxRate: '31.95500',
    payment: 'cash',
    cardTwd: '',
    cardFeeTwd: '',
    receipt: '',
    foreignTaxi: false,
    fxDate: '2026-07-10',
    fxSource: 'manual',
    manualBasis: 'bank',
    fxProofNote: '匿名測試匯率依據',
    ...patch,
  };
}

function report(draft: Draft, count = 1) {
  const m = manifest(draft.template, count);
  const calculation = calculateClaim(draft, { today: '2026-09-09' });
  assert.equal(
    calculation.canExport,
    true,
    JSON.stringify(
      calculation.issues.filter((issue) => issue.severity === 'error'),
    ),
  );
  const changes = buildClaimChanges(draft, calculation, m);
  return { m, calculation, changes, cells: changes[m.sheetName] };
}

function assertExpenseDisplayed(
  result: ReturnType<typeof report>,
  draft: Draft,
  expenseIndex: number,
  exactTwd: string,
) {
  const expense = draft.expenses[expenseIndex];
  const day = draft.days.find((entry) => entry.date === expense.date)!;
  const segment = result.calculation.groups.findIndex((group) =>
    group.dayIds.includes(day.id),
  );
  const address = result.m.segments[segment].fields[expense.category];
  const value = cellText(result.cells[address]).replace(/\n(?==NT\$)/g, '');
  const currency = expense.currency.trim().toUpperCase();
  const conversion = `${currency === 'USD' ? 'US$' : currency}${expense.amount}×${expense.fxRate}`;
  const formula = `${conversion}=NT$${exactTwd}`;
  if (value.split('\n').includes(formula)) return;

  const reference = expenseIndex + 1;
  if (value.includes(`[${reference}]`)) {
    const notes = cellText(result.cells[String(result.m.fields.notes)]);
    const entry = notes.match(new RegExp(`\\[${reference}\\]([^\\[]*)`))?.[1];
    assert.ok(entry, `${address}: missing reference [${reference}] in notes`);
    assert.ok(
      entry.includes(formula),
      `${address}: reference [${reference}] must retain ${formula}`,
    );
    const date = `${Number(expense.date.slice(5, 7))}/${Number(expense.date.slice(8, 10))}`;
    assert.ok(
      entry.startsWith(date),
      `${address}: reference [${reference}] must identify its expense date`,
    );
    return;
  }

  // The supported compact conversion may omit its already-calculated TWD
  // result, but must retain this expense's complete original amount and rate.
  assert.ok(
    value.split('\n').includes(conversion),
    `${address}: missing complete formula, mapped reference, or exact conversion for expense ${reference}`,
  );
}

test('same-currency expenses retain their own rates and exact converted amounts in both forms', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind);
    draft.expenses = [
      expenseFor(draft),
      expenseFor(draft, {
        id: 'expense-b',
        amount: '20',
        fxRate: '30.12345',
      }),
    ];
    const result = report(draft);
    const { m, calculation, changes } = result;
    assertExpenseDisplayed(result, draft, 0, '11184.25');
    assertExpenseDisplayed(result, draft, 1, '602.469');
    assert.deepEqual(
      calculation.categories.find((row) => row.category === 'registration'),
      {
        category: 'registration',
        label: '行政費',
        exactTwd: '11786.719',
        twd: 11787,
      },
    );
    assert.deepEqual(fitClaimText(m, changes).issues, []);
  }
});

test('different currencies remain identifiable beside each expense rate', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind);
    draft.expenses = [
      expenseFor(draft, { currency: 'EUR', fxRate: '35.5' }),
      expenseFor(draft, {
        id: 'expense-b',
        currency: 'JPY',
        amount: '1000',
        fxRate: '0.215',
      }),
    ];
    const result = report(draft);
    assertExpenseDisplayed(result, draft, 0, '12425');
    assertExpenseDisplayed(result, draft, 1, '215');
  }
});

test('TWD, NTD and credit-card actual payments do not inherit stale foreign rates', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind);
    draft.expenses = [
      expenseFor(draft, {
        currency: 'TWD',
        amount: '12',
        category: 'land',
        fxRate: '9999.999',
      }),
      expenseFor(draft, {
        id: 'expense-b',
        currency: 'NTD',
        amount: '7',
        category: 'ship',
        fxRate: '9999.999',
      }),
      expenseFor(draft, {
        id: 'expense-c',
        payment: 'card',
        cardTwd: '500',
        cardFeeTwd: '15',
        fxRate: '9999.999',
      }),
    ];
    const result = report(draft);
    const { m, cells, calculation } = result;
    const fields = m.segments[0].fields;
    assert.equal(cells[fields.land], 'NT$12');
    assert.match(cellText(cells[fields.ship]), /^(?:NT\$|NTD\s*)7$/);
    assert.equal(cells[fields.registration], 'NT$500+15');
    for (const key of ['land', 'ship', 'registration']) {
      assert.doesNotMatch(cellText(cells[fields[key]]), /×|9999\.999|350/);
    }
    assert.deepEqual(
      calculation.expenses.map((row) => row.exactTwd),
      ['12', '7', '515'],
    );
    assert.ok(!cellText(cells[String(m.fields.notes)]).includes(rateLegend));
  }
});

test('total identifies the living-cost rate separately and preserves the funding-limit claim', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind);
    draft.fundingLimit = '1000';
    draft.expenses = [expenseFor(draft)];
    const result = report(draft);
    const { m, cells, calculation } = result;
    assert.equal(calculation.totalTwd, 12084);
    assert.equal(calculation.claimTwd, 1000);
    assert.equal(
      cells[String(m.fields.total)],
      'NT$12,084（生活費美元匯率29.995），僅申請NT$1,000',
    );
    assertExpenseDisplayed(result, draft, 0, '11184.25');
  }
});

test('all expense categories display their own exact conversion without display rounding', () => {
  const categories: Category[] = [
    'flight',
    'ship',
    'land',
    'handling',
    'insurance',
    'registration',
    'misc',
  ];
  for (const kind of kinds) {
    const draft = draftFor(kind);
    draft.expenses = categories.map((category) =>
      expenseFor(draft, {
        id: `expense-${category}`,
        category,
        amount: '0.1',
      }),
    );
    const result = report(draft);
    const { calculation } = result;
    for (const [index, category] of categories.entries()) {
      assertExpenseDisplayed(result, draft, index, '3.1955');
      assert.equal(
        calculation.categories.find((row) => row.category === category)?.twd,
        3,
      );
    }
  }
});

test('narrow columns retain each rate when the full conversion cannot fit, with one explanatory note', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind, 12);
    const segment = kind === 'general' ? 11 : 0;
    draft.expenses = [expenseFor(draft, { date: draft.days[segment].date })];
    const result = report(draft, 12);
    const { m, cells, changes } = result;
    const address = m.segments[segment].fields.registration;
    assertExpenseDisplayed(result, draft, 0, '11184.25');
    const notes = cellText(cells[String(m.fields.notes)]);
    assert.equal(notes.split(rateLegend).length - 1, 1);
    assert.doesNotMatch(notes, /匯\d/);
    const fit = fitClaimText(m, changes);
    assert.equal(fit.changes[m.sheetName][address], cells[address]);
    assert.ok(!fit.issues.some((issue) => issue.cell === address));
  }
});

test('narrow-column references point to complete formulas and use expense order independently of receipt numbers', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind, 12);
    const categories: Category[] = ['land', 'ship', 'registration'];
    draft.expenses = [
      ...categories.map((category, index) =>
        expenseFor(draft, {
          id: `expense-${index}`,
          date: draft.days[1].date,
          category,
          currency: 'TWD',
          amount: '1',
          fxRate: '1',
        }),
      ),
      expenseFor(draft, {
        id: 'expense-fourth',
        category: 'handling',
        currency: 'EUR',
        amount: '15.5',
        fxRate: '37.310001234567',
        receipt: '99',
      }),
    ];
    const result = report(draft, 12);
    const { m, cells, changes } = result;
    const address = m.segments[0].fields.handling;
    const notes = cellText(cells[String(m.fields.notes)]);
    assert.ok(cellText(cells[address]).includes('[4]'));
    assertExpenseDisplayed(result, draft, 3, '578.3050191357885');
    assert.equal(cells[m.segments[0].fields.receipt], '99');
    assert.ok(!notes.includes('[99]'));
    assert.deepEqual(fitClaimText(m, changes).issues, [], kind);
  }
});

test('too many expenses in one narrow cell keep every complete formula and block output with a capacity error', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind, 12);
    draft.expenses = Array.from({ length: 20 }, (_, index) =>
      expenseFor(draft, {
        id: `expense-${index}`,
        category: 'handling',
        amount: String(index + 1),
      }),
    );
    const { m, calculation, cells, changes } = report(draft, 12);
    const address = m.segments[0].fields.handling;
    const complete = draft.expenses
      .map(
        (expense, index) =>
          `US$${expense.amount}×${expense.fxRate}=NT$${calculation.expenses[index].exactTwd}`,
      )
      .join('\n');
    assert.equal(
      cellText(cells[address]).replace(/\n(?==NT\$)/g, ''),
      complete,
    );
    const fit = fitClaimText(m, changes);
    assert.equal(fit.changes[m.sheetName][address], cells[address]);
    assert.ok(
      fit.issues.some(
        (issue) => issue.cell === address && issue.severity === 'error',
      ),
    );
  }
});

test('long precise formulas remain complete in their cell or referenced notes without changing form geometry', () => {
  for (const kind of kinds) {
    const draft = draftFor(kind, 12);
    const amount = '350.123456789012';
    const rate = '31.955001234567';
    draft.expenses = [
      expenseFor(draft, { category: 'handling', amount, fxRate: rate }),
    ];
    const { m, calculation, cells, changes } = report(draft, 12);
    const address = m.segments[0].fields.handling;
    const formula = `US$${amount}×${rate}=NT$${calculation.expenses[0].exactTwd}`;
    const fit = fitClaimText(m, changes);
    assert.equal(fit.changes[m.sheetName][address], cells[address]);
    if (cellText(cells[address]).includes('[1]')) {
      assert.ok(
        cellText(cells[String(m.fields.notes)]).includes(
          `[1]7/13手續費：${formula}。`,
        ),
      );
      assert.ok(!fit.issues.some((issue) => issue.cell === address));
    } else {
      assert.equal(cells[address], formula);
      assert.ok(
        fit.issues.some(
          (issue) => issue.cell === address && issue.severity === 'error',
        ),
      );
    }
    assert.deepEqual(
      fit.manifest.sheets.map((sheet) => ({ ...sheet, cells: [] })),
      m.sheets.map((sheet) => ({ ...sheet, cells: [] })),
    );
  }
});
