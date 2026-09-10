import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  buildTemplateVariant,
  parseBiff,
  workbookStream,
  cellAddress,
} from '../lib/xls/xls-exporter';
const u16 = (d: Uint8Array, o: number) =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(o, true);
const all: Record<string, unknown>[] = [],
  differences: Record<string, unknown>[] = [];
for (const kind of ['general', 'student'] as const) {
  const originalMax = kind === 'general' ? 6 : 7,
    sheet = kind === 'general' ? '國外' : '國外學';
  const original = new Uint8Array(
    readFileSync(`public/templates/${kind}-${originalMax}.xls`),
  );
  const manifest = JSON.parse(
    readFileSync(`public/templates/${kind}-${originalMax}.json`, 'utf8'),
  );
  const byCell: Record<string, number> = {};
  for (const r of parseBiff(workbookStream(original)).filter(
    (r) => r.sheet === sheet,
  )) {
    if ([0xfd, 0x201, 0x203, 0x27e, 0x205].includes(r.id))
      byCell[cellAddress(u16(r.data, 0), u16(r.data, 2))] = u16(r.data, 4);
    if (r.id === 0xbe)
      for (let c = u16(r.data, 2); c <= u16(r.data, r.data.length - 2); c++)
        byCell[cellAddress(u16(r.data, 0), c)] = u16(
          r.data,
          4 + 2 * (c - u16(r.data, 2)),
        );
  }
  // All are existing XFs. The primary text fonts remain 12pt; no new FONT or XF
  // is created. A single-column segment needs a visible right border. Reusing
  // the old right-edge blank indiscriminately would change general work to a
  // Latin font and deductions to 10pt, so those cases use matching existing XFs.
  const single =
    kind === 'general'
      ? [140, 140, 147, 147, 139, 139, 139, 145, 141, 130, 132, 138, 141, 141]
      : [115, 115, 115, 106, 64, 115, 115, 64, 115, 115, 98, 115, 115, 115];
  for (let count = 1; count <= 12; count++) {
    if (count <= originalMax) {
      const prior = JSON.parse(
        readFileSync(`public/templates/${kind}-${count}.json`, 'utf8'),
      );
      all.push({
        id: prior.id,
        kind,
        segmentCount: count,
        file: prior.file,
        sheetName: sheet,
        ranges: prior.ranges,
      });
      continue;
    }
    let cursor = 2;
    // The original M/N columns are wider, especially in the student form.
    // Place paired narrow columns first and leave M/N separate, avoiding a
    // 128pt final group next to a 34pt first group in an eight-column variant.
    const ranges: Array<[number, number]> = Array.from(
      { length: count },
      (_, i) => {
        const width =
            i < 12 % count ? Math.ceil(12 / count) : Math.floor(12 / count),
          start = cursor;
        cursor += width;
        return [start, cursor - 1];
      },
    );
    const merges = [],
      styles: Record<string, number> = {};
    for (let row = 10; row <= 23; row++)
      for (const [c1, c2] of ranges) {
        if (c1 !== c2) merges.push({ r1: row, r2: row, c1, c2 });
        for (let col = c1; col <= c2; col++) {
          const index =
            c1 === c2
              ? single[row - 10]
              : byCell[cellAddress(row, col === c2 ? (c2 === 13 ? 13 : 3) : 2)];
          styles[cellAddress(row, col)] = index;
          if (col === c1) {
            const font = manifest.fonts[manifest.styles[index].fontIndex];
            assert.equal(
              font.size,
              12,
              `${kind} ${count} ${cellAddress(row, col)} primary font must stay 12pt`,
            );
          }
        }
      }
    const id = `${kind}-${count}`,
      file = `${id}.xls`;
    writeFileSync(
      `public/templates/${file}`,
      buildTemplateVariant(original, {
        sheet,
        replaceDateMerges: merges,
        styles,
      }),
    );
    all.push({ id, kind, segmentCount: count, file, sheetName: sheet, ranges });
    differences.push({
      id,
      changedArea: 'C11:N24',
      singleColumnExistingStyleIndexes: single,
      changes: Object.entries(styles)
        .filter(([a, xf]) => byCell[a] !== xf)
        .map(([address, to]) => ({ address, from: byCell[address], to })),
      newFontRecords: 0,
      newStyleRecords: 0,
      displayAnchorFontSizePt: 12,
    });
  }
}
writeFileSync(
  'public/templates/variants.json',
  JSON.stringify(all, null, 2) + '\n',
);
writeFileSync(
  'qa/template-style-differences.json',
  JSON.stringify(differences, null, 2) + '\n',
);
console.log(
  `Prepared ${all.length} variants; ${differences.length} new variants. Existing 13 XLS files unchanged.`,
);
