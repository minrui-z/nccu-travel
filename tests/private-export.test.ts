import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays,
  autoGroupDays,
  calculateClaim,
  canGroupDays,
  createSampleDraft,
  makeDays,
} from '../lib/claim/claim-engine';
import { buildClaimChanges } from '../lib/xls/claim-mapping';
import {
  cellAddress,
  parseBiff,
  patchXls,
  workbookStream,
} from '../lib/xls/xls-exporter';
import type { TemplateManifest } from '../lib/xls/template-manifest';

const today = { today: '2026-09-09' };
const privateDraft = () => {
  const draft = createSampleDraft();
  draft.expenses = [];
  draft.receiptCount = '0';
  draft.fundingLimit = '';
  draft.notes = '';
  draft.fx = { source: 'bot', rate: '', rateDate: '', proofNote: '' };
  draft.days = makeDays(draft.startDate, draft.endDate, { kind: 'personal' });
  draft.groups = autoGroupDays(draft.days);
  return draft;
};
const manifest = (kind: 'general' | 'student', count: number | string) =>
  JSON.parse(
    readFileSync(
      new URL(`../public/templates/${kind}-${count}.json`, import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;

test('private days need only dates and remain exact zero without any living FX', () => {
  const draft = privateDraft();
  const result = calculateClaim(draft, today);
  assert.equal(result.canExport, true);
  assert.equal(result.totalTwd, 0);
  assert.equal(result.claimTwd, 0);
  assert.ok(!result.issues.some((issue) => issue.path.startsWith('fx')));
  for (const day of result.daily) {
    assert.equal(day.eligible, false);
    for (const key of [
      'grossUsd',
      'deductionUsd',
      'netUsd',
      'exactTwd',
    ] as const)
      assert.equal(day[key], '0');
    assert.equal(day.formula, '');
    assert.equal(day.reason, '');
  }
  for (const group of result.groups) {
    for (const key of [
      'location',
      'livingText',
      'deductionText',
      'receipts',
    ] as const)
      assert.equal(group[key], '');
    assert.equal(group.work, '個人行程');
    assert.deepEqual(group.expenses, {});
  }
});

test('legacy private values cannot force allowance, deduction, or FX validation', () => {
  const draft = privateDraft();
  draft.fx = {
    source: 'card',
    rate: 'invalid',
    rateDate: '2099-01-01',
    proofNote: '',
  };
  draft.days = draft.days.map((day, i) => ({
    ...day,
    location: `舊地點${i}`,
    work: `舊工作${i}`,
    usdRate: 'invalid',
    extraDeductionUsd: '-100',
    rateSource: 'manual',
    lodgingProvided: true,
    breakfast: true,
  }));
  const before = JSON.stringify(draft);
  assert.equal(canGroupDays(draft.days), false);
  draft.groups = autoGroupDays(draft.days);
  const regrouped = JSON.stringify(draft);
  const result = calculateClaim(draft, today);
  assert.notEqual(regrouped, before);
  assert.equal(JSON.stringify(draft), regrouped);
  assert.equal(result.canExport, true);
  assert.equal(result.totalTwd, 0);
  assert.equal(result.groups.length, draft.days.length);
  assert.equal(result.groups[0].livingText, '');
});

test('mixed trips still require the living FX and claimable daily rate', () => {
  const draft = privateDraft();
  draft.days[0].kind = 'official';
  draft.days[0].location = '東京';
  draft.days[0].work = '會議';
  draft.groups = autoGroupDays(draft.days);
  const result = calculateClaim(draft, today);
  assert.equal(result.canExport, false);
  assert.ok(result.issues.some((issue) => issue.path === 'fx.rate'));
  assert.ok(result.issues.some((issue) => issue.path === 'fx.rateDate'));
  assert.ok(result.issues.some((issue) => issue.path === 'days.0.usdRate'));
  assert.ok(!result.issues.some((issue) => issue.path === 'days.1.usdRate'));
});

test('private-date expenses remain in totals and block export until corrected', () => {
  const draft = privateDraft();
  draft.expenses = [
    {
      id: 'receipt-private',
      date: draft.startDate,
      category: 'handling',
      description: '應人工調整列支日期的費用',
      amount: '10',
      currency: 'EUR',
      fxRate: '35',
      fxDate: '2026-07-10',
      fxSource: 'manual',
      fxProofNote: '官方歷史報價',
      payment: 'cash',
      cardTwd: '',
      cardFeeTwd: '',
      receipt: '1',
      foreignTaxi: false,
    },
  ];
  draft.receiptCount = '1';
  const result = calculateClaim(draft, today);
  assert.equal(result.totalTwd, 350);
  assert.equal(result.expenses[0].exactTwd, '350');
  assert.equal(result.canExport, false);
  assert.ok(
    result.issues.some((issue) => issue.code === 'expense-ineligible-day'),
  );
  assert.deepEqual(result.groups[0].expenses, {});
  assert.equal(result.groups[0].receipts, '');
  draft.expenses[0].fxRate = '';
  assert.ok(
    calculateClaim(draft, today).issues.some(
      (issue) => issue.path === 'expenses.0.fxRate',
    ),
  );
});

test('all 24 native XLS variants identify personal travel and optional location while claim cells remain BLANK', () => {
  const u16 = (data: Uint8Array, offset = 0) =>
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(
      offset,
      true,
    );
  for (const kind of ['general', 'student'] as const)
    for (let count = 1; count <= 12; count++) {
      const draft = privateDraft();
      draft.template = kind;
      draft.endDate = addDays(draft.startDate, count - 1);
      draft.days = makeDays(draft.startDate, draft.endDate, {
        kind: 'personal',
        location: '舊地點',
        work: '舊工作',
        usdRate: '395',
      });
      draft.groups = draft.days.map((day) => ({
        id: day.id,
        dayIds: [day.id],
      }));
      const m = manifest(kind, count);
      const result = calculateClaim(draft, today);
      assert.equal(result.canExport, true);
      const changes = buildClaimChanges(draft, result, m);
      const cells = changes[m.sheetName];
      const template = readFileSync(
        new URL(`../public/templates/${m.file}`, import.meta.url),
      );
      const output = patchXls(template, changes);
      const records = parseBiff(workbookStream(output));
      for (const segment of m.segments) {
        assert.notEqual(cells[segment.fields.month], null);
        assert.notEqual(cells[segment.fields.day], null);
        for (const [field, address] of Object.entries(segment.fields)) {
          if (field === 'month' || field === 'day') continue;
          if (field === 'location' || field === 'work') {
            assert.equal(
              cells[address],
              field === 'work' ? '個人行程' : '舊地點',
            );
            continue;
          }
          assert.equal(cells[address], null, `${m.id} ${address}`);
          const cell = records.find(
            (record) =>
              record.sheet === m.sheetName &&
              [0x201, 0xfd, 0x203, 0x27e, 0x205].includes(record.id) &&
              cellAddress(u16(record.data), u16(record.data, 2)) === address,
          );
          assert.equal(
            cell?.id,
            0x201,
            `${m.id} ${address} must be native BLANK`,
          );
        }
      }
      assert.equal(cells[String(m.fields.total)], 'NT$0');
      assert.ok(!JSON.stringify(cells).includes('無免費供餐'));
    }
});

test('mixed student shared work retains date-specific personal labels without using stale work text', () => {
  const draft = privateDraft();
  draft.template = 'student';
  draft.endDate = addDays(draft.startDate, 6);
  draft.fx = createSampleDraft().fx;
  draft.days = makeDays(draft.startDate, draft.endDate, {
    kind: 'personal',
    location: '私人舊地點',
    work: '私人舊工作',
    usdRate: '395',
  });
  Object.assign(draft.days[1], {
    kind: 'official',
    location: '東京',
    work: '研究交流',
    usdRate: '299',
  });
  draft.groups = draft.days.map((day) => ({ id: day.id, dayIds: [day.id] }));
  const m = manifest('student', 7);
  const cells = buildClaimChanges(draft, calculateClaim(draft, today), m)[
    m.sheetName
  ];
  assert.equal(
    cells.C14,
    '7/13：個人行程；7/14：研究交流；7/15：個人行程；7/16：個人行程；7/17：個人行程；7/18：個人行程',
  );
  assert.ok(!JSON.stringify(cells).includes('私人舊工作'));
  assert.equal(cells[m.segments[0].fields.location], '私人舊地點');
  for (const field of ['living', 'deduction', 'receipt'])
    assert.equal(cells[m.segments[0].fields[field]], null);
  assert.equal(cells[m.segments[1].fields.location], '東京');
});

test('student private seven-column variant prints personal work and keeps all claim fields blank', () => {
  const draft = privateDraft();
  draft.template = 'student';
  draft.endDate = addDays(draft.startDate, 6);
  draft.fx = createSampleDraft().fx;
  draft.days = makeDays(draft.startDate, draft.endDate, {
    kind: 'personal',
    location: '私人舊地點',
    work: '私人舊工作',
    usdRate: '395',
  });
  Object.assign(draft.days[1], {
    kind: 'official',
    location: '東京',
    work: '研究交流',
    usdRate: '299',
  });
  Object.assign(draft.days[3], {
    kind: 'official',
    location: '東京',
    work: '發表論文',
    usdRate: '299',
  });
  draft.groups = draft.days.map((day) => ({ id: day.id, dayIds: [day.id] }));
  const m = manifest('student', '7-private');
  const result = calculateClaim(draft, today);
  assert.equal(result.canExport, true);
  const changes = buildClaimChanges(draft, result, m);
  const cells = changes[m.sheetName];
  const template = readFileSync(
    new URL(`../public/templates/${m.file}`, import.meta.url),
  );
  const records = parseBiff(workbookStream(patchXls(template, changes)));
  const u16 = (data: Uint8Array, offset = 0) =>
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(
      offset,
      true,
    );
  m.segments.forEach((segment, i) => {
    if (draft.days[i].kind !== 'personal') {
      assert.equal(cells[segment.fields.work], draft.days[i].work);
      return;
    }
    for (const [field, address] of Object.entries(segment.fields)) {
      if (field === 'month' || field === 'day') continue;
      if (field === 'location' || field === 'work') {
        assert.equal(
          cells[address],
          field === 'work' ? '個人行程' : '私人舊地點',
        );
        continue;
      }
      assert.equal(cells[address], null, address);
      assert.ok(
        records.some(
          (record) =>
            record.sheet === m.sheetName &&
            record.id === 0x201 &&
            cellAddress(u16(record.data), u16(record.data, 2)) === address,
        ),
        `${address} must be native BLANK`,
      );
    }
  });
  assert.ok(!JSON.stringify(cells).includes('私人舊工作'));
});
