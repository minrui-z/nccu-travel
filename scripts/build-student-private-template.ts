import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildTemplateVariant, cellAddress } from '../lib/xls/xls-exporter';
import type { TemplateManifest } from '../lib/xls/template-manifest';

/** The original seven-column student form shares C14:M14 across six dates.
 * A private day needs its own blank work cell, so only that row is partitioned.
 * All style indexes refer to styles already present in the unchanged original.
 */
export function buildStudentPrivateTemplate(
  original: Uint8Array,
  source: TemplateManifest,
) {
  if (source.id !== 'student-7' || source.segmentCount !== 7)
    throw new Error('Expected the original student-7 template.');
  const sheet = source.sheets.find((item) => item.name === source.sheetName)!;
  const shared = sheet.merges.find(
    (range) =>
      range.r1 === 13 && range.r2 === 13 && range.c1 === 2 && range.c2 === 12,
  );
  if (!shared) throw new Error('Original shared work cell is missing.');
  const workMerges = source.segments.flatMap(({ startCol, endCol }) =>
    startCol < endCol ? [{ r1: 13, r2: 13, c1: startCol, c2: endCol }] : [],
  );
  const merges = sheet.merges
    .filter((range) => range !== shared)
    .concat(workMerges);
  const styles: Record<string, number> = {};
  for (const { startCol, endCol } of source.segments.slice(0, 6)) {
    for (let col = startCol; col <= endCol; col++)
      styles[cellAddress(13, col)] =
        startCol === endCol ? 106 : col === startCol ? 116 : 137;
  }
  const bytes = buildTemplateVariant(original, {
    sheet: source.sheetName,
    replaceDateMerges: merges.filter(
      (range) =>
        range.r1 >= 10 && range.r2 <= 23 && range.c1 >= 2 && range.c2 <= 13,
    ),
    styles,
  });
  const manifest = structuredClone(source);
  manifest.id = 'student-7-private';
  manifest.file = manifest.id + '.xls';
  manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.segments.forEach((segment) => {
    segment.fields.work = cellAddress(13, segment.startCol);
  });
  const outputSheet = manifest.sheets.find(
    (item) => item.name === source.sheetName,
  )!;
  outputSheet.merges = merges;
  outputSheet.cells.forEach((cell) => {
    if (Object.hasOwn(styles, cell.address))
      cell.styleIndex = styles[cell.address];
  });
  return { bytes, manifest };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = new URL('../public/templates/', import.meta.url);
  const source = JSON.parse(
    readFileSync(new URL('student-7.json', directory), 'utf8'),
  ) as TemplateManifest;
  const { bytes, manifest } = buildStudentPrivateTemplate(
    readFileSync(new URL('student-7.xls', directory)),
    source,
  );
  writeFileSync(new URL(manifest.file, directory), bytes);
  writeFileSync(
    new URL(manifest.id + '.json', directory),
    JSON.stringify(manifest) + '\n',
  );
  console.log(`${manifest.id}: ${manifest.sha256}`);
}
