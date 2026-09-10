import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSampleDraft,
  createEmptyDraft,
  calculateClaim,
  makeDays,
  addDays,
} from '../lib/claim/claim-engine';
import {
  buildClaimChanges,
  validateClaimCapacity,
} from '../lib/xls/claim-mapping';
import { fitClaimText } from '../lib/xls/text-fitting';
import { patchXls } from '../lib/xls/xls-exporter';
import type { TemplateManifest } from '../lib/xls/template-manifest';
const manifest = (id: string) =>
  JSON.parse(
    readFileSync(
      new URL('../public/templates/' + id + '.json', import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;
const sample = () => {
  const d = createSampleDraft();
  d.notes = '匿名測試資料';
  d.days = d.days.map((day) => ({
    ...day,
    work: day.work === '出席會議並發表論文' ? '發表論文' : day.work,
  }));
  return d;
};
test('both browser sample mappings preserve original cabin questions and can fit', () => {
  for (const kind of ['general', 'student'] as const) {
    const d = sample();
    d.template = kind;
    const c = calculateClaim(d);
    const m = manifest(kind + '-4');
    const changes = buildClaimChanges(d, c, m);
    assert.equal(c.totalTwd, 77759);
    assert.deepEqual(fitClaimText(m, changes).issues, []);
    const bytes = readFileSync(
      new URL('../public/templates/' + m.file, import.meta.url),
    );
    const output = patchXls(bytes, changes);
    assert.equal(
      Buffer.from(output.subarray(0, 8)).toString('hex'),
      'd0cf11e0a1b11ae1',
    );
    const noteValue = changes[m.sheetName][String(m.fields.notes)];
    const notes =
      typeof noteValue === 'object' && noteValue
        ? noteValue.text
        : String(noteValue ?? '');
    if (kind === 'general') {
      assert.ok(notes.includes('基礎等級'));
      assert.ok(notes.includes('全額主管加給'));
      assert.ok(notes.includes('是☑'));
    }
    assert.ok(notes.includes('匿名測試資料'));
    assert.equal(typeof changes[m.sheetName].C25, 'string');
    assert.ok((changes[m.sheetName].C25 as string).includes('77,759'));
  }
});
function simpleVariant(
  kind: 'general' | 'student',
  count: number,
  usdRate = '100',
) {
  const d = sample();
  d.template = kind;
  d.expenses = [];
  d.fundingLimit = '';
  d.notes = '';
  d.purpose = '公差';
  d.person = { ...d.person, name: '出差人', title: '人員' };
  d.startDate = d.approvedStart = '2026-07-13';
  d.endDate = d.approvedEnd = addDays(d.startDate, count - 1);
  d.days = makeDays(d.startDate, d.endDate, {
    location: '城市',
    work: '公差',
    usdRate,
    weekendOfficial: true,
  });
  d.groups = d.days.map((day) => ({ id: 'g-' + day.id, dayIds: [day.id] }));
  return d;
}
test('every column count fits generated no-meal text and return-day formula without changing templates', () => {
  for (const kind of ['general', 'student'] as const)
    for (let count = 1; count <= 12; count++) {
      const d = simpleVariant(kind, count),
        m = manifest(kind + '-' + count),
        c = calculateClaim(d),
        changes = buildClaimChanges(d, c, m);
      assert.equal(
        c.canExport,
        true,
        JSON.stringify(c.issues.filter((i) => i.severity === 'error')),
      );
      assert.deepEqual(fitClaimText(m, changes).issues, [], kind + '-' + count);
      assert.equal(c.groups.flatMap((g) => g.dayIds).length, count);
      for (const group of m.segments) {
        assert.equal(
          typeof changes[m.sheetName][group.fields.deduction],
          'string',
        );
        assert.match(
          changes[m.sheetName][group.fields.deduction] as string,
          /^無(?:免費(?:供)?餐)?$/,
        );
      }
    }
});
test('narrow living field retains the complete pre-meal calculation and separate meal deduction', () => {
  const d = simpleVariant('student', 7, '100000');
  d.days[6].breakfast = true;
  const m = manifest('student-7'),
    c = calculateClaim(d),
    changes = buildClaimChanges(d, c, m);
  assert.equal(c.groups[6].grossUsd, '30000');
  assert.equal(c.groups[6].netUsd, '26000');
  assert.equal(changes[m.sheetName].N18, '100000×30%=30000');
  assert.equal(changes[m.sheetName].N23, 'US$4000');
  assert.equal(changes[m.sheetName].M23, '無免費餐');
  assert.deepEqual(fitClaimText(m, changes).issues, []);
});
test('text capacity and raw newline boundaries block export rather than truncate', () => {
  const d = sample(),
    m = manifest('general-4');
  d.purpose = '研討會'.repeat(100);
  const changes = buildClaimChanges(d, calculateClaim(d), m);
  assert.ok(validateClaimCapacity(m, changes).some((i) => i.cell === 'C9'));
  assert.equal(changes[m.sheetName].C9, d.purpose);
  d.purpose = '會議';
  d.notes = '備註'.repeat(100);
  assert.ok(
    validateClaimCapacity(m, buildClaimChanges(d, calculateClaim(d), m)).some(
      (i) => i.cell === 'C26',
    ),
  );
  const s = manifest('student-4');
  d.template = 'student';
  d.notes = '';
  d.days[2].work = '第一行\n第二行';
  d.days[3].work = '第一行\n第二行';
  assert.ok(
    validateClaimCapacity(s, buildClaimChanges(d, calculateClaim(d), s)).some(
      (i) => i.label === '工作記要',
    ),
  );
});
test('empty drafts still show live person fields while date cells stay blank', () => {
  const d = createEmptyDraft();
  d.person.name = '新姓名';
  const m = manifest('general-6');
  const changes = buildClaimChanges(d, calculateClaim(d), m);
  assert.equal(changes[m.sheetName].B8, '新姓名');
  assert.equal(changes[m.sheetName].C11, null);
});
test('student seven-column shared work never writes into hidden cells', () => {
  const d = sample();
  d.template = 'student';
  d.startDate = d.approvedStart = '2026-07-13';
  d.endDate = d.approvedEnd = '2026-07-19';
  d.days = makeDays(d.startDate, d.endDate, {
    location: '東京',
    work: '研討會',
    usdRate: '299',
    weekendOfficial: true,
  });
  d.groups = d.days.map((day) => ({ id: 'g-' + day.id, dayIds: [day.id] }));
  const m = manifest('student-7'),
    changes = buildClaimChanges(d, calculateClaim(d), m)[m.sheetName];
  assert.equal(changes.C14, '研討會');
  assert.equal(changes.N14, '研討會');
  for (const a of [
    'D14',
    'E14',
    'F14',
    'G14',
    'H14',
    'I14',
    'J14',
    'K14',
    'L14',
    'M14',
  ])
    assert.equal(Object.hasOwn(changes, a), false);
});
