import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSampleDraft,
  calculateClaim,
  makeDays,
} from '../lib/claim/claim-engine';
import {
  buildClaimChanges,
  validateClaimCapacity,
} from '../lib/xls/claim-mapping';
import { fitClaimText } from '../lib/xls/text-fitting';
import type { TemplateManifest } from '../lib/xls/template-manifest';

const student12 = () => {
  const draft = createSampleDraft();
  draft.template = 'student';
  draft.expenses = [];
  draft.fundingLimit = '';
  draft.notes = '';
  draft.purpose = '公差';
  draft.person = { ...draft.person, name: '出差人', title: '人員' };
  draft.startDate = draft.approvedStart = '2026-07-13';
  draft.endDate = draft.approvedEnd = '2026-07-24';
  draft.days = makeDays(draft.startDate, draft.endDate, {
    location: '城市',
    work: '公差',
    usdRate: '100',
    weekendOfficial: true,
  });
  draft.groups = draft.days.map((day) => ({
    id: 'g-' + day.id,
    dayIds: [day.id],
  }));
  return draft;
};
const manifest = (count: number) =>
  JSON.parse(
    readFileSync(
      new URL(`../public/templates/student-${count}.json`, import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;

test('twelve date columns use defined no-meal shorthand and retain every day', () => {
  const draft = student12(),
    m = manifest(12),
    calc = calculateClaim(draft);
  const changes = buildClaimChanges(draft, calc, m),
    cells = changes[m.sheetName];
  assert.deepEqual(fitClaimText(m, changes).issues, []);
  assert.equal(calc.groups.flatMap((group) => group.dayIds).length, 12);
  for (const group of m.segments)
    assert.match(
      cells[group.fields.deduction] as string,
      /^無(?:免費(?:供)?餐)?$/,
    );
  assert.equal(cells.C23, '無');
  const note = cells.C26;
  assert.ok(note && typeof note === 'object');
  assert.match(note.text, /扣除欄「無」表示無免費供餐。/);
  assert.doesNotMatch(note.text, /「航」|美元/);
  assert.equal(cells.N18, '100×30%=30');
});

test('flight-meal and decimal deductions retain their distinct meanings in narrow fields', () => {
  const draft = student12();
  draft.days[2].kind = 'flight';
  draft.days[2].mealsInFlight = true;
  draft.days[3].lunch = true;
  draft.days[3].usdRate = '268';
  const m = manifest(12),
    calc = calculateClaim(draft);
  const changes = buildClaimChanges(draft, calc, m),
    cells = changes[m.sheetName];
  assert.equal(cells.E23, '航');
  assert.equal(cells.E18, '100×30%=30');
  assert.equal(typeof cells.E18, 'string');
  assert.equal(calc.groups[3].deductionUsd, '21.44');
  assert.equal(cells.F23, 'US$21.44');
  assert.equal(typeof cells.F23, 'string');
  const note = cells.C26;
  assert.ok(note && typeof note === 'object');
  assert.match(note.text, /扣除欄「航」表示航程供餐不扣。/);
  assert.equal(
    note.text.split('生活費與扣除金額均為美元（US$）。').length - 1,
    0,
  );
});

test('labels add no unused legend in wide cells and never silently shorten deduction values', () => {
  const draft = student12();
  draft.endDate = draft.approvedEnd = draft.startDate;
  draft.days = draft.days.slice(0, 1);
  draft.groups = draft.groups.slice(0, 1);
  const m = manifest(1),
    calc = calculateClaim(draft);
  const cells = buildClaimChanges(draft, calc, m)[m.sheetName];
  assert.equal(cells.C23, '無免費供餐');
  assert.equal(cells.C26, null);

  const narrowDraft = student12();
  narrowDraft.days[3].extraDeductionUsd = '1.123456789012';
  const narrow = manifest(12),
    result = calculateClaim(narrowDraft);
  const changes = buildClaimChanges(narrowDraft, result, narrow);
  assert.equal(changes[narrow.sheetName].F23, 'US$1.123456789012');
  assert.ok(
    validateClaimCapacity(narrow, changes).some(
      (issue) => issue.cell === 'F23',
    ),
  );
});

test('student funding note and all used legends are retained even when C26 becomes full', () => {
  const draft = student12();
  draft.fundingLimit = '1';
  draft.notes = '使用者原始備註'.repeat(50);
  draft.days[2].kind = 'flight';
  draft.days[2].mealsInFlight = true;
  const m = manifest(12),
    calc = calculateClaim(draft);
  const changes = buildClaimChanges(draft, calc, m),
    note = changes[m.sheetName].C26;
  assert.ok(note && typeof note === 'object');
  assert.match(note.text, /核定上限NT\$1/);
  assert.match(note.text, /不向本案報支/);
  assert.match(note.text, /「無」/);
  assert.match(note.text, /「航」/);
  assert.doesNotMatch(note.text, /生活費與扣除金額均為美元/);
  assert.ok(note.text.endsWith(draft.notes));
  assert.ok(
    validateClaimCapacity(m, changes).some(
      (issue) => issue.cell === 'C26' && issue.severity === 'error',
    ),
  );
});
