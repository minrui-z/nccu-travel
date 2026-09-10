import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateClaim,
  createSampleDraft,
  makeDays,
} from '../lib/claim/claim-engine';
import { buildClaimChanges } from '../lib/xls/claim-mapping';
import { fitClaimText } from '../lib/xls/text-fitting';
import type { TemplateManifest } from '../lib/xls/template-manifest';

test('every narrow living cell includes its full result, with the complete calculation retained on the same form', () => {
  for (const kind of ['general', 'student'] as const) {
    const d = createSampleDraft();
    d.template = kind;
    d.expenses = [];
    d.notes = '';
    d.fundingLimit = '';
    d.startDate = d.approvedStart = '2026-09-01';
    d.endDate = '2026-09-12';
    d.days = makeDays(d.startDate, d.endDate, {
      location: '臺北→美國波士頓',
      work: '交通',
      kind: 'flight',
      usdRate: '395',
    });
    d.days.forEach((day, index) => {
      day.usdRate = index % 2 ? '320' : '395';
    });
    d.groups = d.days.map((day) => ({ id: day.id, dayIds: [day.id] }));
    const m = JSON.parse(
      readFileSync(
        new URL(`../public/templates/${kind}-12.json`, import.meta.url),
        'utf8',
      ),
    ) as TemplateManifest;
    const calc = calculateClaim(d);
    const fitted = fitClaimText(m, buildClaimChanges(d, calc, m));
    assert.deepEqual(fitted.issues, [], kind);
    const cells = fitted.changes[m.sheetName];
    const note = cells[String(m.fields.notes)];
    const noteText = note && typeof note === 'object' ? note.text : '';
    m.segments.forEach((segment, index) => {
      const full = index % 2 ? '320×30%=96' : '395×30%=118.5';
      const amount = index % 2 ? '96' : '118.5';
      const printed = cells[segment.fields.living];
      assert.ok(
        printed === full || printed === amount,
        `${kind}: ${JSON.stringify(printed)}`,
      );
      if (printed === amount) assert.ok(noteText.includes(full));
      if (kind === 'student') assert.equal(printed, full);
    });
    assert.equal(calc.groups[0].grossUsd, '118.5');
  }
});

test('merged four-day allowance retains the final zero and its unrounded monetary result', () => {
  const d = createSampleDraft();
  d.template = 'student';
  d.expenses = [];
  d.notes = '';
  d.fundingLimit = '';
  d.days = makeDays('2026-09-03', '2026-09-06', {
    kind: 'official',
    location: '波士頓',
    work: '會議',
    usdRate: '395',
  });
  d.days.forEach((day) => {
    day.kind = 'official';
  });
  d.groups = [{ id: 'merged', dayIds: d.days.map((day) => day.id) }];
  const calc = calculateClaim(d);
  const m = JSON.parse(
    readFileSync(
      new URL('../public/templates/student-7.json', import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;
  const fit = fitClaimText(m, buildClaimChanges(d, calc, m));
  assert.equal(
    fit.changes[m.sheetName][m.segments[0].fields.living],
    '395×4=1580',
  );
  assert.equal(calc.groups[0].grossUsd, '1580');
  assert.deepEqual(fit.issues, []);
});
