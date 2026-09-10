import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as CFB from 'cfb';
import { buildStudentPrivateTemplate } from '../scripts/build-student-private-template';
import {
  cellAddress,
  parseBiff,
  workbookStream,
} from '../lib/xls/xls-exporter';
import type { BiffRecord } from '../lib/xls/xls-exporter';
import type { TemplateManifest } from '../lib/xls/template-manifest';

const asset = (name: string) =>
  readFileSync(new URL(`../public/templates/${name}`, import.meta.url));
const original = asset('student-7.xls');
const changed = asset('student-7-private.xls');
const manifest = (name: string) =>
  JSON.parse(asset(name).toString()) as TemplateManifest;
const source = manifest('student-7.json');
const output = manifest('student-7-private.json');
const u16 = (data: Uint8Array, offset = 0) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(
    offset,
    true,
  );
const isWork = (row: number, col: number) =>
  row === 13 && col >= 2 && col <= 12;
const cellIds = new Set([0xfd, 0x201, 0x203, 0x27e, 0x205, 0xbe]);

function cells(records: BiffRecord[]) {
  const result = new Map<
    string,
    { style: number; id: number; data: number[]; work: boolean }
  >();
  for (const record of records) {
    if (!cellIds.has(record.id)) continue;
    const row = u16(record.data),
      first = u16(record.data, 2);
    const last =
      record.id === 0xbe ? u16(record.data, record.data.length - 2) : first;
    for (let col = first; col <= last; col++) {
      result.set(`${record.sheet}!${cellAddress(row, col)}`, {
        style: u16(record.data, record.id === 0xbe ? 4 + 2 * (col - first) : 4),
        id: record.id === 0xbe ? 0x201 : record.id,
        data: record.id === 0xbe ? [] : Array.from(record.data.subarray(6)),
        work: isWork(row, col),
      });
    }
  }
  return result;
}

test('student private-day layout reproduces deterministically without changing its original baseline', () => {
  const regenerated = buildStudentPrivateTemplate(original, source);
  assert.deepEqual(Buffer.from(regenerated.bytes), changed);
  assert.deepEqual(regenerated.manifest, output);
  assert.equal(
    createHash('sha256').update(changed).digest('hex'),
    output.sha256,
  );
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    source.sha256,
  );
  assert.deepEqual(output.fonts, source.fonts);
  assert.deepEqual(output.styles, source.styles);
  assert.deepEqual(
    output.segments.map((segment) => segment.fields.work),
    ['C14', 'E14', 'G14', 'I14', 'K14', 'M14', 'N14'],
  );
  assert.equal(source.segments[5].fields.work, 'C14');
});

test('student private-day layout changes only work-row merging and existing style assignments', () => {
  const before = parseBiff(workbookStream(original));
  const after = parseBiff(workbookStream(changed));
  // Only physical indexes, cell records and the merge collection may differ.
  const relocatable = new Set([0x85, 0x20b, 0xd7, 0xff, 0xe5]);
  const stable = (records: BiffRecord[]) =>
    records
      .filter(
        (record) => !cellIds.has(record.id) && !relocatable.has(record.id),
      )
      .map((record) => ({
        id: record.id,
        sheet: record.sheet,
        data: [...record.data],
      }));
  assert.deepEqual(stable(after), stable(before));
  const beforeCells = cells(before),
    afterCells = cells(after);
  assert.deepEqual(
    [...afterCells.keys()].sort(),
    [...beforeCells.keys()].sort(),
  );
  let changedStyles = 0;
  for (const [address, cell] of beforeCells) {
    const next = afterCells.get(address)!;
    if (!cell.work) assert.deepEqual(next, cell, address);
    else {
      assert.deepEqual({ ...next, style: cell.style }, cell, address);
      if (next.style !== cell.style) changedStyles++;
    }
  }
  assert.equal(changedStyles, 10);
  const workMerge = (range: {
    r1: number;
    r2: number;
    c1: number;
    c2: number;
  }) => range.r1 === 13 && range.r2 === 13 && range.c1 >= 2 && range.c2 <= 12;
  assert.deepEqual(
    output.sheets[0].merges.filter((range) => !workMerge(range)),
    source.sheets[0].merges.filter((range) => !workMerge(range)),
  );
  assert.deepEqual(
    output.sheets[0].merges.filter(workMerge),
    [
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
      [10, 11],
    ].map(([c1, c2]) => ({ r1: 13, r2: 13, c1, c2 })),
  );
  assert.deepEqual(output.sheets[0].rowHeights, source.sheets[0].rowHeights);
  assert.deepEqual(
    output.sheets[0].columnWidths,
    source.sheets[0].columnWidths,
  );
  const streams = (bytes: Uint8Array) => {
    const cfb = CFB.read(bytes, { type: 'array' });
    return cfb.FileIndex.flatMap((entry, index) =>
      entry.type === 2 &&
      entry.name !== 'Workbook' &&
      entry.name !== '\u0001Sh33tJ5'
        ? [{ path: cfb.FullPaths[index], data: [...entry.content] }]
        : [],
    );
  };
  assert.deepEqual(streams(changed), streams(original));
});
