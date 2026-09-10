import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitClaimText } from '../lib/xls/text-fitting';
import {
  buildClaimChanges,
  validateClaimCapacity,
} from '../lib/xls/claim-mapping';
import { createSampleDraft, calculateClaim } from '../lib/claim/claim-engine';
import {
  parseBiff,
  patchXls,
  workbookStream,
  type XlsChanges,
} from '../lib/xls/xls-exporter';
import type { TemplateManifest } from '../lib/xls/template-manifest';

const manifest = (kind: 'general' | 'student', count = 4) =>
  JSON.parse(
    readFileSync(
      new URL(`../public/templates/${kind}-${count}.json`, import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;
const bytes = (m: TemplateManifest) =>
  readFileSync(new URL(`../public/templates/${m.file}`, import.meta.url));
const u16 = (bytes: Uint8Array, offset = 0) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    true,
  );

test('editable text wraps and reduces size within the unchanged original cell geometry', () => {
  for (const kind of ['general', 'student'] as const) {
    const m = manifest(kind),
      address = m.segments[0].fields.work;
    const changes: XlsChanges = {
      [m.sheetName]: {
        C9: '國際學術研討會發表研究成果並參與跨國研究合作與方法交流座談會議'.repeat(
          2,
        ),
        [address]: '第一行工作記要\n第二行研究討論',
      },
    };
    const source = JSON.stringify(m),
      original = JSON.stringify(changes);
    assert.ok(validateClaimCapacity(m, changes).length);
    const fit = fitClaimText(m, changes);
    assert.deepEqual(fit.issues, []);
    assert.ok(fit.adjustments.length);
    assert.equal(JSON.stringify(m), source);
    assert.equal(JSON.stringify(changes), original);
    assert.equal(
      fit.changes[m.sheetName][address],
      changes[m.sheetName][address],
    );
    assert.deepEqual(
      fit.manifest.sheets.map((s) => ({ ...s, cells: [] })),
      m.sheets.map((s) => ({ ...s, cells: [] })),
    );
    for (const adjustment of fit.adjustments)
      assert.ok(adjustment.fontSize >= 8);
  }
});

test('all 24 templates support automatically fitted native text without replacing original FONT/XF records', () => {
  for (const kind of ['general', 'student'] as const)
    for (let count = 1; count <= 12; count++) {
      const m = manifest(kind, count),
        address = m.segments[0].fields.location;
      const changes: XlsChanges = {
        [m.sheetName]: { [address]: '美國\n波士頓\n研究所' },
      };
      const fit = fitClaimText(m, changes);
      assert.deepEqual(fit.issues, [], `${kind}-${count}`);
      const original = parseBiff(workbookStream(bytes(m))),
        out = parseBiff(
          workbookStream(patchXls(bytes(m), fit.changes, fit.formatting)),
        );
      for (const id of [0x31, 0xe0]) {
        const base = original.filter((r) => r.id === id),
          next = out.filter((r) => r.id === id);
        assert.deepEqual(
          next.slice(0, base.length).map((r) => r.data),
          base.map((r) => r.data),
        );
      }
      for (const id of [
        0x208, 0x7d, 0xe5, 0xa1, 0x26, 0x27, 0x28, 0x29, 0xec, 0x5d, 0x1b6,
      ])
        assert.deepEqual(
          out.filter((r) => r.id === id).map((r) => r.data),
          original.filter((r) => r.id === id).map((r) => r.data),
        );
      const cell = fit.manifest.sheets[0].cells.find(
        (c) => c.address === address,
      )!;
      const nativeCell = out.find(
        (r) =>
          r.sheet === m.sheetName &&
          r.id === 0xfd &&
          u16(r.data) === cell.row &&
          u16(r.data, 2) === cell.col,
      )!;
      assert.equal(u16(nativeCell.data, 4), cell.styleIndex);
      const xf = out.filter((r) => r.id === 0xe0)[cell.styleIndex];
      const expected = fit.manifest.styles[cell.styleIndex];
      assert.equal(!!(xf.data[6] & 8), expected.wrap);
      assert.equal(u16(xf.data), expected.fontIndex);
      const font = out.filter((r) => r.id === 0x31)[
        expected.fontIndex > 4 ? expected.fontIndex - 1 : expected.fontIndex
      ];
      assert.equal(
        u16(font.data) / 20,
        fit.manifest.fonts[expected.fontIndex].size,
      );
    }
});

test('rich text keeps every character, run boundary, font family and emphasis when size changes', () => {
  const m = manifest('general'),
    d = createSampleDraft();
  d.notes = '出差經費分攤依補助核定項目辦理。'.repeat(5);
  const changes = buildClaimChanges(d, calculateClaim(d), m),
    fit = fitClaimText(m, changes),
    address = String(m.fields.notes);
  const original = changes[m.sheetName][address],
    next = fit.changes[m.sheetName][address];
  assert.ok(
    original &&
      typeof original === 'object' &&
      next &&
      typeof next === 'object',
  );
  assert.equal(next.text, original.text);
  assert.deepEqual(
    next.runs?.map((r) => r.start),
    original.runs?.map((r) => r.start),
  );
  assert.ok(fit.adjustments.some((a) => a.cell === address));
  assert.deepEqual(fit.issues, []);
  original.runs?.forEach((run, i) => {
    const old = m.fonts[run.fontIndex],
      updated = fit.manifest.fonts[next.runs![i].fontIndex];
    assert.deepEqual({ ...updated, size: old.size }, old);
    assert.ok(updated.size >= 8);
  });
  assert.doesNotThrow(() => patchXls(bytes(m), fit.changes, fit.formatting));
});

test('unfillable text stays complete and requires a user edit; fitting never alters fixed form labels', () => {
  const m = manifest('general'),
    content = '完整工作記要'.repeat(100),
    changes: XlsChanges = {
      [m.sheetName]: { C14: content, A1: '固定標題'.repeat(100) },
    };
  const fit = fitClaimText(m, changes);
  assert.equal(fit.changes[m.sheetName].C14, content);
  assert.ok(fit.issues.some((i) => i.cell === 'C14'));
  assert.ok(!fit.adjustments.some((a) => a.cell === 'A1'));
});

test('short text produces identical native output and invalid formatting references are rejected', () => {
  const m = manifest('general'),
    changes: XlsChanges = { [m.sheetName]: { C9: '研討會' } };
  const fit = fitClaimText(m, changes);
  assert.deepEqual(fit.adjustments, []);
  assert.deepEqual(
    patchXls(bytes(m), changes),
    patchXls(bytes(m), fit.changes, fit.formatting),
  );
  assert.throws(
    () => patchXls(bytes(m), changes, { ...fit.formatting, fontCount: 0 }),
    /模板版本/,
  );
  assert.throws(
    () =>
      patchXls(bytes(m), changes, {
        ...fit.formatting,
        cells: { [m.sheetName]: { A1: 999 } },
      }),
    /本次填寫/,
  );
});

test('fitting a normal-font expense preserves column measurement and appends its smaller font', () => {
  const m = manifest('general', 7);
  const address = 'K19';
  const cell = m.sheets[0].cells.find((cell) => cell.address === address)!;
  assert.equal(m.styles[cell.styleIndex].fontIndex, 0);
  const changes = { [m.sheetName]: { [address]: 'EUR15.5×37.31' } };
  const fit = fitClaimText(m, changes);
  assert.deepEqual(fit.issues, []);
  assert.deepEqual(fit.manifest.fonts[0], m.fonts[0]);
  assert.deepEqual(
    fit.manifest.sheets[0].columnWidths,
    m.sheets[0].columnWidths,
  );
  assert.ok(
    fit.formatting.fonts.some(
      (font) => font.sourceIndex === 0 && font.size < 12,
    ),
  );
  const native = parseBiff(
    workbookStream(patchXls(bytes(m), fit.changes, fit.formatting)),
  );
  const original = parseBiff(workbookStream(bytes(m)));
  assert.deepEqual(
    native.find((record) => record.id === 0x31)?.data,
    original.find((record) => record.id === 0x31)?.data,
  );
});
