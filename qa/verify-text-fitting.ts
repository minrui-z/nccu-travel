import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fitClaimText } from '../lib/xls/text-fitting';
import { patchXls } from '../lib/xls/xls-exporter';
import { buildClaimChanges } from '../lib/xls/claim-mapping';
import { createSampleDraft, calculateClaim } from '../lib/claim/claim-engine';
import type { TemplateManifest } from '../lib/xls/template-manifest';
const out = process.argv[2] || 'qa-output/text-fitting';
mkdirSync(out, { recursive: true });
const expected = [];
for (const kind of ['general', 'student'] as const)
  for (let count = 1; count <= 12; count++) {
    const m = JSON.parse(
      readFileSync(`public/templates/${kind}-${count}.json`, 'utf8'),
    ) as TemplateManifest;
    const changes = {
      [m.sheetName]: {
        [m.segments[0].fields.location]: '美國\n波士頓\n研究所',
      },
    };
    const fit = fitClaimText(m, changes);
    if (fit.issues.length) throw new Error(JSON.stringify(fit.issues));
    const file = `${kind}-${count}-fit.xls`;
    writeFileSync(
      `${out}/${file}`,
      patchXls(
        readFileSync(`public/templates/${m.file}`),
        fit.changes,
        fit.formatting,
      ),
    );
    expected.push({
      file,
      sheet: m.sheetName,
      cells: Object.entries(fit.changes[m.sheetName]).map(
        ([address, value]) => {
          const cell = fit.manifest.sheets[0].cells.find(
            (c) => c.address === address,
          )!;
          const style = fit.manifest.styles[cell.styleIndex];
          return {
            address,
            row: cell.row,
            col: cell.col,
            value,
            style: cell.styleIndex,
            wrap: style.wrap,
            size: fit.manifest.fonts[style.fontIndex].size,
          };
        },
      ),
    });
  }
for (const kind of ['general', 'student'] as const) {
  const m = JSON.parse(
    readFileSync(`public/templates/${kind}-4.json`, 'utf8'),
  ) as TemplateManifest;
  const d = createSampleDraft();
  d.template = kind;
  d.purpose =
    '國際學術研討會發表研究成果並參與跨國研究合作與方法交流座談會議'.repeat(2);
  d.notes = '出差經費分攤依補助核定項目辦理。'.repeat(
    kind === 'general' ? 5 : 3,
  );
  d.days = d.days.map((day) => ({
    ...day,
    work: '第一行工作記要\n第二行研究討論',
  }));
  const fit = fitClaimText(m, buildClaimChanges(d, calculateClaim(d), m));
  if (fit.issues.length) throw new Error(JSON.stringify(fit.issues));
  const file = `${kind}-full-fit.xls`;
  writeFileSync(
    `${out}/${file}`,
    patchXls(
      readFileSync(`public/templates/${m.file}`),
      fit.changes,
      fit.formatting,
    ),
  );
  expected.push({
    file,
    sheet: m.sheetName,
    cells: Object.entries(fit.changes[m.sheetName]).map(([address, value]) => {
      const cell = fit.manifest.sheets[0].cells.find(
        (c) => c.address === address,
      )!;
      const style = fit.manifest.styles[cell.styleIndex];
      return {
        address,
        row: cell.row,
        col: cell.col,
        value,
        style: cell.styleIndex,
        wrap: style.wrap,
        size: fit.manifest.fonts[style.fontIndex].size,
      };
    }),
  });
}
writeFileSync(`${out}/expected.json`, JSON.stringify(expected, null, 2));
console.log(`Wrote ${expected.length} native XLS fitting fixtures.`);
