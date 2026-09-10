import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitClaimText } from '../lib/xls/text-fitting';
import type { TemplateManifest } from '../lib/xls/template-manifest';

test('student 7 and 12 columns retain the complete living formula and result within original geometry', () => {
  for (const count of [7, 12]) {
    const source = JSON.parse(
      readFileSync(
        new URL(`../public/templates/student-${count}.json`, import.meta.url),
        'utf8',
      ),
    ) as TemplateManifest;
    for (const formula of ['395×30%=118.5', '395×4=1580', '320×30%=96']) {
      const changes = {
        [source.sheetName]: Object.fromEntries(
          source.segments.map((segment) => [segment.fields.living, formula]),
        ),
      };
      const fit = fitClaimText(source, changes);
      assert.deepEqual(fit.issues, []);
      assert.deepEqual(fit.changes, changes);
      assert.deepEqual(
        fit.manifest.sheets[0].columnWidths,
        source.sheets[0].columnWidths,
      );
      assert.deepEqual(
        fit.manifest.sheets[0].rowHeights,
        source.sheets[0].rowHeights,
      );
      assert.deepEqual(fit.manifest.sheets[0].merges, source.sheets[0].merges);
      for (const segment of source.segments) {
        const cell = fit.manifest.sheets[0].cells.find(
          (item) => item.address === segment.fields.living,
        )!;
        const style = fit.manifest.styles[cell.styleIndex];
        assert.ok(fit.manifest.fonts[style.fontIndex].size >= 8);
        assert.equal(fit.changes[source.sheetName][cell.address], formula);
      }
    }
  }
});
