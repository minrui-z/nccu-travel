import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSampleDraft, calculateClaim } from '../lib/claim/claim-engine';
import { studentFundingNote } from '../lib/claim/student-funding-note';
import {
  buildClaimChanges,
  validateClaimCapacity,
} from '../lib/xls/claim-mapping';
import { fitClaimText } from '../lib/xls/text-fitting';
import type { TemplateManifest } from '../lib/xls/template-manifest';

const manifest = (kind: 'general' | 'student') =>
  JSON.parse(
    readFileSync(
      new URL(`../public/templates/${kind}-4.json`, import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;
const student = () => {
  const draft = createSampleDraft();
  draft.template = 'student';
  draft.notes = '匿名測試資料';
  draft.days.forEach((day) => {
    if (day.work === '出席會議並發表論文') day.work = '發表論文';
  });
  return draft;
};

test('student cap keeps calculated expenses and reports claim plus self-funded difference', () => {
  const draft = student(),
    calc = calculateClaim(draft),
    m = manifest('student');
  assert.equal(calc.totalTwd, 77759);
  assert.equal(calc.claimTwd, 70000);
  const note = studentFundingNote(draft, calc);
  assert.equal(note, '核定上限NT$70,000；超額NT$7,759自行負擔，不向本案報支。');
  const changes = buildClaimChanges(draft, calc, m),
    cells = changes[m.sheetName];
  assert.equal(
    (m.fields.amountDigits as string[])
      .map((a) => (typeof cells[a] === 'number' ? String(cells[a]) : ''))
      .join(''),
    '70000',
  );
  assert.equal(cells.C25, 'NT$77,759（生活費美元匯率29.995），僅申請NT$70,000');
  assert.deepEqual(cells.C26, {
    text: '費用格「×」後為各筆外幣折合臺幣匯率。 ' + note + ' 匿名測試資料',
    runs: [],
  });
  assert.deepEqual(fitClaimText(m, changes).issues, []);
  const unlimited = structuredClone(draft);
  unlimited.fundingLimit = '';
  const fullCalc = calculateClaim(unlimited),
    fullCells = buildClaimChanges(unlimited, fullCalc, m)[m.sheetName];
  assert.deepEqual(fullCalc.daily, calc.daily);
  assert.deepEqual(fullCalc.categories, calc.categories);
  for (const group of m.segments) {
    assert.equal(cells[group.fields.living], fullCells[group.fields.living]);
    assert.equal(
      cells[group.fields.deduction],
      fullCells[group.fields.deduction],
    );
  }
});

test('a shared grant discloses unclaimed amount without labelling it self-funded', () => {
  const draft = student();
  draft.funding!.shared = true;
  const calc = calculateClaim(draft),
    m = manifest('student');
  const note = studentFundingNote(draft, calc);
  assert.equal(
    note,
    '核定上限NT$70,000；差額NT$7,759不向本案報支，依分攤表辦理。',
  );
  assert.doesNotMatch(note, /自行負擔|實際支出/);
  assert.deepEqual(
    fitClaimText(m, buildClaimChanges(draft, calc, m)).issues,
    [],
  );
});

test('zero limit is supported; absent, non-binding, and invalid caps add no disclosure', () => {
  const draft = student();
  draft.fundingLimit = '0';
  assert.equal(
    studentFundingNote(draft, calculateClaim(draft)),
    '核定上限NT$0；超額NT$77,759自行負擔，不向本案報支。',
  );
  for (const value of ['', '77759', '80000', '70000.5', '-1', '未定']) {
    draft.fundingLimit = value;
    assert.equal(studentFundingNote(draft, calculateClaim(draft)), '', value);
  }
});

test('general form keeps its existing notes and rich-text runs', () => {
  const draft = student();
  draft.template = 'general';
  const calc = calculateClaim(draft),
    m = manifest('general');
  assert.equal(studentFundingNote(draft, calc), '');
  const cells = buildClaimChanges(draft, calc, m)[m.sheetName];
  const note = cells.C26;
  assert.ok(note && typeof note === 'object');
  assert.ok(note.text.endsWith('匿名測試資料'));
  assert.match(note.text, /全額主管加給/);
  assert.doesNotMatch(note.text, /核定上限|不向本案報支/);
  const original = m.sheets[0].cells.find((c) => c.address === 'C26')!;
  assert.deepEqual(note.runs!.slice(0, original.runs.length), original.runs);
});

test('student note overflow retains all text and produces a specific blocking capacity issue', () => {
  const draft = student(),
    m = manifest('student');
  draft.notes = '自填完整備註\n'.repeat(20) + '最後一字';
  const calc = calculateClaim(draft),
    changes = buildClaimChanges(draft, calc, m);
  const note = changes[m.sheetName].C26;
  assert.ok(note && typeof note === 'object');
  assert.ok(note.text.endsWith(draft.notes));
  assert.ok(note.text.includes(studentFundingNote(draft, calc)));
  assert.ok(
    validateClaimCapacity(m, changes).some(
      (issue) =>
        issue.cell === 'C26' &&
        issue.severity === 'error' &&
        issue.fieldKey === 'notes' && /備註/.test(issue.message),
    ),
  );
});
