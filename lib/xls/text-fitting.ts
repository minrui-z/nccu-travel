import {
  estimateCellCapacity,
  validateClaimCapacity,
  type CapacityIssue,
} from './claim-mapping';
import type {
  TemplateManifest,
  TemplateCell,
  TemplateSheet,
} from './template-manifest';
import type { XlsChanges, XlsValue, XlsTextFormatting } from './xls-exporter';

export interface TextFitAdjustment {
  sheet: string;
  cell: string;
  wrap: boolean;
  fontSize: number;
}
export interface TextFitResult {
  manifest: TemplateManifest;
  changes: XlsChanges;
  formatting: XlsTextFormatting;
  adjustments: TextFitAdjustment[];
  issues: CapacityIssue[];
}
const MIN_SIZE = 8;
function fits(
  value: XlsValue,
  cell: TemplateCell,
  sheet: TemplateSheet,
  manifest: TemplateManifest,
) {
  const m = estimateCellCapacity(value, cell, sheet, manifest);
  const text =
    typeof value === 'object' && value ? value.text : String(value ?? '');
  return (
    text.length <= manifest.limits.maxTextLength &&
    (m.wrap || !text.includes('\n')) &&
    (m.wrap
      ? m.estimatedLines <= m.availableLines && m.estimatedWidthPt <= m.widthPt
      : m.estimatedLines <= m.availableLines &&
        (m.shrinkToFit
          ? m.effectiveFontSize >= MIN_SIZE
          : m.estimatedWidthPt <= m.widthPt))
  );
}
/** Fit editable contents within the original cell geometry. Never truncates text or changes calculations. */
export function fitClaimText(
  source: TemplateManifest,
  input: XlsChanges,
): TextFitResult {
  const manifest: TemplateManifest = {
    ...source,
    fonts: source.fonts.map((f) => ({ ...f })),
    styles: source.styles.map((s) => ({ ...s })),
    sheets: source.sheets.map((s) => ({
      ...s,
      cells: s.cells.map((c) => ({ ...c })),
    })),
  };
  const changes: XlsChanges = Object.fromEntries(
    Object.entries(input).map(([sheet, cells]) => [sheet, { ...cells }]),
  );
  const formatting: XlsTextFormatting = {
    fontCount: source.fonts.length,
    styleCount: source.styles.length,
    fonts: [],
    styles: [],
    cells: {},
  };
  const adjustments: TextFitAdjustment[] = [];
  const allowed = new Set([
    'A7',
    'B7',
    ...Object.values(source.fields).flatMap((v) =>
      typeof v === 'string' ? [v] : Array.isArray(v) ? v : [],
    ),
    ...source.segments.flatMap((s) => Object.values(s.fields)),
  ]);
  const fontCache = new Map<string, number>(),
    styleCache = new Map<string, number>();
  const fontAt = (index: number, size: number) => {
    if (source.fonts[index].size === size) return index;
    const key = `${index}/${size}`;
    const existing = fontCache.get(key);
    if (existing !== undefined) return existing;
    const added = manifest.fonts.length;
    manifest.fonts.push({ ...source.fonts[index], size });
    formatting.fonts.push({ sourceIndex: index, index: added, size });
    fontCache.set(key, added);
    return added;
  };
  for (const [sheetName, cells] of Object.entries(changes)) {
    const sheet = manifest.sheets.find((s) => s.name === sheetName);
    if (!sheet) continue;
    for (const [address, value] of Object.entries(cells)) {
      if (
        sheetName !== source.sheetName ||
        !allowed.has(address) ||
        value === null ||
        value === '' ||
        typeof value === 'number'
      )
        continue;
      const cell = sheet.cells.find((c) => c.address === address);
      if (!cell || fits(value, cell, sheet, manifest)) continue;
      const originalStyle = source.styles[cell.styleIndex],
        baseFont = originalStyle.fontIndex;
      const runFonts =
        typeof value === 'object'
          ? (value.runs ?? []).map((r) => r.fontIndex)
          : [];
      const usedFonts = [...new Set([baseFont, ...runFonts])];
      const maxSize = Math.max(...usedFonts.map((i) => source.fonts[i].size));
      let selected: { sizes: Map<number, number>; wrap: boolean } | null = null;
      // Prefer wrapping at the template size, then the largest readable half-point size.
      for (
        let target = maxSize;
        target >= MIN_SIZE;
        target = Math.ceil(target * 2 - 1) / 2
      ) {
        const sizes = new Map(
          usedFonts.map((i) => [
            i,
            Math.min(
              source.fonts[i].size,
              Math.max(
                MIN_SIZE,
                Math.floor(((source.fonts[i].size * target) / maxSize) * 20) /
                  20,
              ),
            ),
          ]),
        );
        // Font 0 also determines the workbook's column-width units. Trial
        // smaller copies just as the native exporter does; mutating font 0
        // here would incorrectly shrink the available cell width as well.
        const trialFonts = [...manifest.fonts];
        const trialFontMap = new Map<number, number>();
        for (const [index, size] of sizes) {
          trialFontMap.set(index, trialFonts.length);
          trialFonts.push({ ...source.fonts[index], size });
        }
        const trialValue =
          typeof value === 'object'
            ? {
                text: value.text,
                runs: value.runs?.map((run) => ({
                  ...run,
                  fontIndex: trialFontMap.get(run.fontIndex)!,
                })),
              }
            : value;
        for (const wrap of originalStyle.wrap ? [true] : [true, false]) {
          const trialStyle = {
            ...originalStyle,
            fontIndex: trialFontMap.get(baseFont)!,
            wrap,
            shrinkToFit: false,
          };
          const trial = {
            ...manifest,
            fonts: trialFonts,
            styles: [...manifest.styles, trialStyle],
          };
          if (
            fits(
              trialValue,
              { ...cell, styleIndex: trial.styles.length - 1 },
              sheet,
              trial,
            )
          ) {
            selected = { sizes, wrap };
            break;
          }
        }
        if (selected) break;
      }
      if (!selected) continue;
      const fontMap = new Map(
        [...selected.sizes].map(([index, size]) => [
          index,
          fontAt(index, size),
        ]),
      );
      const fontIndex = fontMap.get(baseFont)!;
      const key = `${cell.styleIndex}/${fontIndex}/${selected.wrap}`;
      let styleIndex = styleCache.get(key);
      if (styleIndex === undefined) {
        styleIndex = manifest.styles.length;
        formatting.styles.push({
          sourceIndex: cell.styleIndex,
          index: styleIndex,
          fontIndex,
          wrap: selected.wrap,
        });
        manifest.styles.push({
          ...originalStyle,
          fontIndex,
          wrap: selected.wrap,
          shrinkToFit: false,
        });
        styleCache.set(key, styleIndex);
      }
      cell.styleIndex = styleIndex;
      if (typeof value === 'object')
        cells[address] = {
          text: value.text,
          runs: value.runs?.map((r) => ({
            ...r,
            fontIndex: fontMap.get(r.fontIndex)!,
          })),
        };
      (formatting.cells[sheetName] ??= {})[address] = styleIndex;
      adjustments.push({
        sheet: sheetName,
        cell: address,
        wrap: selected.wrap,
        fontSize: manifest.fonts[fontIndex].size,
      });
    }
  }
  const issues = validateClaimCapacity(manifest, changes).map((issue) => ({
    ...issue,
    message: `${issue.label}超出表格空間，請精簡文字${/^起訖地點|工作記要$/.test(issue.label) ? '或合併相同內容的日期' : ''}。`,
  }));
  return { manifest, changes, formatting, adjustments, issues };
}
