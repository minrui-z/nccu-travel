/** Portable test runner: npx tsx qa/verify-xls.ts --templates public/templates --engine lib/xls/xls-exporter.ts --output qa-output */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as CFB from 'cfb';
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const templateDir = resolve(option('--templates', 'public/templates'));
const engineFile = resolve(option('--engine', 'lib/xls/xls-exporter.ts'));
const outputDir = resolve(option('--output', 'qa-output'));
const u16 = (d: Uint8Array, o: number) =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(o, true);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
interface RecordData {
  id: number;
  data: Uint8Array;
  sheet: string;
}
type Value =
  | string
  | number
  | null
  | { text: string; runs: Array<{ start: number; fontIndex: number }> };
type Changes = Record<string, Value>;
async function main() {
  const { patchXls, parseBiff, workbookStream, cellAddress } = await import(
    pathToFileURL(engineFile).href
  );
  mkdirSync(outputDir, { recursive: true });
  const cases: Record<
    string,
    {
      file: string;
      type: string;
      kind: string;
      sheet: string;
      changes: Changes;
    }
  > = {};
  const assets: Record<string, string> = {};
  let checks = 0;
  const count = (fn: () => void) => {
    fn();
    checks++;
  };
  function records(bytes: Uint8Array): RecordData[] {
    return parseBiff(workbookStream(bytes));
  }
  function auxiliary(before: Uint8Array, after: Uint8Array, label: string) {
    const a = CFB.read(before, { type: 'array' }),
      b = CFB.read(after, { type: 'array' });
    for (const entry of a.FileIndex.filter(
      (e) => e.type === 2 && e.name !== 'Workbook',
    ))
      count(() =>
        assert.deepEqual(
          Uint8Array.from(CFB.find(b, entry.name)!.content),
          Uint8Array.from(entry.content),
          `${label} OLE stream ${entry.name}`,
        ),
      );
  }
  function stableRecords(
    before: Uint8Array,
    after: Uint8Array,
    label: string,
    allowLayout = false,
  ) {
    // Sheet-local CONTINUE records belong to drawings and must remain byte-identical.
    // Global CONTINUE records are appended SST chunks. These are independently read by xlrd.
    const permitted = new Set([
      0xfc, 0xff, 0x85, 0x20b, 0xd7, 0xfd, 0x201, 0xbe, 0x203, 0x27e, 0x205,
    ]);
    if (allowLayout) permitted.add(0xe5);
    const invariant = (r: RecordData) =>
      !permitted.has(r.id) && !(r.id === 0x3c && r.sheet === '');
    const compact = (r: RecordData) => [r.id, r.sheet, Array.from(r.data)];
    count(() =>
      assert.deepEqual(
        records(after).filter(invariant).map(compact),
        records(before).filter(invariant).map(compact),
        `${label} changed an unapproved BIFF record`,
      ),
    );
    auxiliary(before, after, label);
  }
  function styles(rs: RecordData[], sheet: string) {
    const result: Record<string, number> = {};
    for (const r of rs.filter((r) => r.sheet === sheet)) {
      if ([0xfd, 0x201, 0x203, 0x27e, 0x205].includes(r.id))
        result[cellAddress(u16(r.data, 0), u16(r.data, 2))] = u16(r.data, 4);
      if (r.id === 0xbe)
        for (
          let col = u16(r.data, 2);
          col <= u16(r.data, r.data.length - 2);
          col++
        )
          result[cellAddress(u16(r.data, 0), col)] = u16(
            r.data,
            4 + 2 * (col - u16(r.data, 2)),
          );
    }
    return result;
  }
  function save(
    id: string,
    kind: string,
    type: string,
    sheet: string,
    input: Uint8Array,
    changes: Changes,
  ) {
    const snapshot = input.slice(),
      result = patchXls(input, { [sheet]: changes });
    count(() => assert.deepEqual(input, snapshot, `${id} mutated input`));
    stableRecords(input, result, id);
    count(() =>
      assert.deepEqual(
        styles(records(result), sheet),
        styles(records(input), sheet),
        `${id} changed cell formats`,
      ),
    );
    const file = `${id}.xls`;
    writeFileSync(join(outputDir, file), result);
    cases[id] = { file, type, kind, sheet, changes };
  }
  for (const kind of ['general', 'student']) {
    const originalMax = kind === 'general' ? 6 : 7,
      max = Number(option('--max-columns', '12')),
      sheet = kind === 'general' ? '國外' : '國外學';
    const base = new Uint8Array(
      readFileSync(join(templateDir, `${kind}-${originalMax}.xls`)),
    );
    count(() =>
      assert.deepEqual(
        patchXls(base, {}),
        base,
        `${kind} no-op must be byte-identical`,
      ),
    );
    for (let n = 1; n <= max; n++) {
      const id = `${kind}-${n}`,
        m = JSON.parse(readFileSync(join(templateDir, `${id}.json`), 'utf8'));
      const bytes = new Uint8Array(
        readFileSync(join(templateDir, `${id}.xls`)),
      );
      assets[id] = sha(bytes);
      count(() => assert.equal(assets[id], m.sha256, `${id} manifest SHA-256`));
      count(() => assert.equal(m.segmentCount, n));
      count(() => assert.equal(m.sheetName, sheet));
      stableRecords(base, bytes, `${id} static layout`, true);
      const beforeXf = styles(records(base), sheet),
        afterXf = styles(records(bytes), sheet);
      for (const [address, xf] of Object.entries(beforeXf)) {
        const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address)!;
        if (+row < 11 || +row > 24 || col === 'A' || col === 'B')
          count(() =>
            assert.equal(
              afterXf[address],
              xf,
              `${id} non-date style ${address}`,
            ),
          );
      }
      const changes: Changes = {
        B8: '測試使用者',
        C9: '赴日本東京參加學術研討會',
        A10: {
          text: '西元2026年9月1日起2026年9月7日止共計7日 附單據5張',
          runs: m.sheets[0].cells.find((c: any) => c.address === 'A10').runs,
        },
        C25: 37145,
      };
      for (const [i, seg] of m.segments.entries()) {
        const f = seg.fields;
        Object.assign(changes, {
          [f.month]: 9,
          [f.day]: String(i + 1),
          [f.location]: '日本\n東京',
          [f.work]: '研習',
          [f.flight]: i === 0 ? 12500 : null,
          [f.ship]: null,
          [f.land]: i === 0 ? 350 : null,
          [f.living]: 640.6,
          [f.handling]: null,
          [f.insurance]: null,
          [f.registration]: i === 0 ? 3500 : null,
          [f.misc]: null,
          [f.deduction]: 0,
          [f.receipt]: String(i + 1),
        });
      }
      save(id, kind, 'variant', sheet, bytes, changes);
      console.log(
        `PASS ${id}: manifest, original geometry/styles/drawings, cell patch and OLE streams`,
      );
    }
    save(`${kind}-rich`, kind, 'rich', sheet, base, {
      B8: {
        text: '陳一明',
        runs: [
          { start: 0, fontIndex: 0 },
          { start: 1, fontIndex: 7 },
        ],
      },
      C9: '中文・Ω・é・😀',
      C15: 0,
      C16: null,
      C18: 1030.625,
      C25: 1031,
    });
    const many: Changes = {};
    for (const col of ['C', 'E', 'G', 'I', 'K', 'M'])
      for (let row = 11; row <= 24; row++)
        many[`${col}${row}`] = `${col}${row}:` + '長文字測試'.repeat(100);
    save(`${kind}-continued`, kind, 'sst-stress', sheet, base, many);
    count(() =>
      assert.throws(() => patchXls(base, { [sheet]: { Z900: 'x' } })),
    );
    count(() =>
      assert.throws(() =>
        patchXls(base, { [sheet]: { B8: 'x'.repeat(2049) } }),
      ),
    );
    count(() =>
      assert.throws(() => patchXls(base, { [sheet]: { B8: '\ud800' } })),
    );
    count(() =>
      assert.throws(() => patchXls(base, { [sheet]: { B8: '\u0000' } })),
    );
    count(() =>
      assert.throws(() => patchXls(base, { [sheet]: { C25: Infinity } })),
    );
    count(() =>
      assert.throws(() =>
        patchXls(base, {
          [sheet]: { B8: { text: '甲', runs: [{ start: 0, fontIndex: 999 }] } },
        }),
      ),
    );
    console.log(
      `PASS ${kind}: Unicode, rich text, SST continuation stress and invalid-input checks`,
    );
  }
  writeFileSync(
    join(outputDir, 'xls-report.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        passed: true,
        nodeVersion: process.version,
        cfbVersion: (CFB as any).version,
        engineSha256: sha(new Uint8Array(readFileSync(engineFile))),
        checks,
        variantCount: Object.values(cases).filter((c) => c.type === 'variant')
          .length,
        caseCount: Object.keys(cases).length,
        assets,
        cases,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${checks} assertions, ${Object.keys(cases).length} output workbooks. Report: ${relative(process.cwd(), join(outputDir, 'xls-report.json'))}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
