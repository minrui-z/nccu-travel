import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  FileSpreadsheet,
  Maximize,
  X,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TemplateManifest, TemplateFont } from '@/lib/xls/template-types';
import type { WorkbenchDraft } from './model';
import { estimateCellCapacity } from '@/lib/xls/claim-mapping';
import type { Issue } from '@/lib/claim/types';
import { previewPaneHeight, previewPaperWidth } from '@/lib/preview-viewport';
import './preview-check.css';
type Value =
  | string
  | number
  | null
  | { text: string; runs?: Array<{ start: number; fontIndex: number }> };
function address(a: string) {
  const m = a.match(/^([A-Z]+)([0-9]+)$/);
  if (!m) return { row: 0, col: 0 };
  let c = 0;
  for (const s of m[1]) c = c * 26 + s.charCodeAt(0) - 64;
  return { row: Number(m[2]) - 1, col: c - 1 };
}
function fontStyle(f: TemplateFont | undefined, ratio = 1) {
  return {
    fontFamily:
      '"' +
      (f?.name ?? '標楷體') +
      '", "BiauKai", "Noto Serif TC Variable", serif',
    fontSize: (f?.size ?? 12) * ratio,
    fontWeight: f?.bold ? 700 : 400,
    fontStyle: f?.italic ? 'italic' : 'normal',
    color: f?.color ?? '#000',
    textDecoration: f?.underline ? 'underline' : undefined,
  };
}
/** Excel measures actual glyphs for shrink-to-fit; fallback browser fonts may be wider. */
function PreviewText({
  children,
  shrink,
  wrap,
  align,
  blockAlign,
  vertical,
}: {
  children: ReactNode;
  shrink: boolean;
  wrap: boolean;
  align: 'left' | 'center' | 'right';
  blockAlign: 'top' | 'center' | 'bottom';
  vertical: boolean;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [fitting, setFitting] = useState({ ratio: 1, x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!shrink || !element.current?.parentElement) return;
    const text = element.current;
    const cell = text.parentElement!;
    let active = true;
    const fit = () => {
      if (!active) return;
      const style = getComputedStyle(cell);
      // Measure glyph bounds, including ascenders/descenders outside a short
      // line box. Wrapped fallback fonts can add a line Excel did not need.
      const previousTransform = text.style.transform;
      text.style.transform = 'none';
      const box = cell.getBoundingClientRect();
      const origin = text.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const ink = range.getBoundingClientRect();
      text.style.transform = previousTransform;
      const scaleX = box.width / parseFloat(style.width);
      const scaleY = box.height / parseFloat(style.height);
      if (!scaleX || !scaleY || !ink.width || !ink.height) return;
      const left = box.left + (parseFloat(style.paddingLeft) + 0.25) * scaleX;
      const top = box.top + (parseFloat(style.paddingTop) + 0.25) * scaleY;
      const width =
        box.width -
        (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 0.5) *
          scaleX;
      const height =
        box.height -
        (parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 0.5) *
          scaleY;
      const ratio = Math.min(
        1,
        Math.max(0, width) / ink.width,
        Math.max(0, height) / ink.height,
      );
      const x =
        (left +
          (width - ink.width * ratio) *
            (align === 'left' ? 0 : align === 'right' ? 1 : 0.5) -
          origin.left -
          (ink.left - origin.left) * ratio) /
        scaleX;
      const y =
        (top +
          (height - ink.height * ratio) *
            (blockAlign === 'top' ? 0 : blockAlign === 'bottom' ? 1 : 0.5) -
          origin.top -
          (ink.top - origin.top) * ratio) /
        scaleY;
      setFitting((previous) =>
        Math.abs(previous.ratio - ratio) < 0.00001 &&
        Math.abs(previous.x - x) < 0.001 &&
        Math.abs(previous.y - y) < 0.001
          ? previous
          : { ratio, x, y },
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(text);
    observer.observe(cell);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener('loadingdone', fit);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', fit);
    };
  }, [children, shrink, wrap, align, blockAlign]);
  return (
    <span
      ref={element}
      style={{
        writingMode: vertical ? 'vertical-rl' : undefined,
        ...(shrink
          ? {
              width: wrap ? '100%' : 'max-content',
              flexShrink: 0,
              alignSelf: 'flex-start',
              transform: `translate(${fitting.x}px, ${fitting.y}px) scale(${fitting.ratio})`,
              transformOrigin: '0 0',
            }
          : {}),
      }}
    >
      {children}
    </span>
  );
}

function PreviewShell({
  children,
  toolbar,
  tabs,
  footer,
  expanded,
  wholePage,
}: {
  children: ReactNode;
  toolbar: ReactNode;
  tabs: ReactNode;
  footer: ReactNode;
  expanded: boolean;
  wholePage: boolean;
}) {
  const pane = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (expanded || !pane.current) return;
    let frame = 0;
    const measure = () => {
      if (!pane.current) return;
      const top = pane.current.getBoundingClientRect().top;
      const stickyTop = parseFloat(getComputedStyle(pane.current).top) || 20;
      setHeight(previewPaneHeight(window.innerHeight, top, stickyTop));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    if (pane.current.parentElement)
      observer.observe(pane.current.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
    };
  }, [expanded]);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const x = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const y = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setWidth(
        previewPaperWidth(
          element.clientWidth - x,
          element.clientHeight - y,
          wholePage,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.scrollTo({ top: 0, left: 0 });
    return () => observer.disconnect();
  }, [wholePage]);
  return (
    <section
      ref={pane}
      className={`preview-pane preview-workspace${expanded ? ' preview-workspace-expanded' : ''}`}
      style={expanded ? undefined : { height }}
      aria-label="原表預覽"
    >
      {toolbar}
      {tabs}
      <div
        ref={surface}
        className={`paper-surface preview-viewport${wholePage ? ' is-whole-page' : ' is-zoomed'}`}
        tabIndex={wholePage ? undefined : 0}
        role="region"
        aria-label={wholePage ? 'A4 整頁預覽' : '放大表格，可上下及左右捲動'}
      >
        <div className="preview-page-frame" style={{ width }}>
          {children}
        </div>
      </div>
      {footer}
    </section>
  );
}
export function ReportPreview({
  manifest,
  changes,
  draft,
  focused,
  errors,
  onReviewIssues,
}: {
  manifest: TemplateManifest | null;
  changes: Record<string, Record<string, Value>>;
  draft: WorkbenchDraft;
  focused: string;
  errors: Issue[];
  onReviewIssues?: () => void;
}) {
  const [page, setPage] = useState(0);
  const [large, setLarge] = useState(false);
  const [wholeExpanded, setWholeExpanded] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const restoreOpener = useRef(true);
  useLayoutEffect(() => {
    const dialog = modal.current;
    if (!dialog) return;
    if (large && !dialog.open) dialog.showModal();
    else if (!large && dialog.open) dialog.close();
  }, [large, manifest]);
  const effectivePage = manifest?.sheets[page] ? page : 0;
  const sheet = manifest?.sheets[effectivePage];
  if (!manifest || !sheet)
    return (
      <section className="preview-pane">
        <div className="preview-toolbar">
          <span>
            <FileSpreadsheet size={16} />
            原表預覽
          </span>
          <span>A4 直式</span>
        </div>
        <div className="preview-loading" role="status">
          載入表格中…
        </div>
      </section>
    );
  const widths = sheet.columnWidths.map(
      (w) => (w / 256) * manifest.fonts[0].size * 0.5,
    ),
    heights = sheet.rowHeights;
  const xs = [0],
    ys = [0];
  widths.forEach((w) => xs.push(xs.at(-1)! + w));
  heights.forEach((h) => ys.push(ys.at(-1)! + h));
  const scale = Math.min(541 / xs.at(-1)!, 798 / ys.at(-1)!);
  const highlights = new Set<string>();
  const main = effectivePage === 0;
  if (main) {
    const keys =
      focused === 'person'
        ? ['name', 'identity', 'title', 'grade']
        : focused === 'purpose'
          ? ['reason']
          : focused === 'budget'
            ? []
            : focused === 'total'
              ? ['total']
              : focused === 'notes'
                ? ['notes']
                : [];
    keys.forEach((key) => {
      const a = manifest.fields[key];
      if (typeof a === 'string') highlights.add(a);
    });
    if (focused === 'budget') {
      highlights.add('A7');
      highlights.add('B7');
    }
    if (focused === 'period') highlights.add('A10');
    if (focused.startsWith('day:')) {
      const i = draft.groups.findIndex((g) =>
        g.dayIds.includes(focused.slice(4)),
      );
      const g = manifest.segments[i];
      if (g) Object.values(g.fields).forEach((a) => highlights.add(a));
    }
    if (focused === 'expenses')
      manifest.segments.forEach((g) =>
        [
          'flight',
          'ship',
          'land',
          'handling',
          'insurance',
          'registration',
          'misc',
        ].forEach((k) => highlights.add(g.fields[k])),
      );
  }
  const cellChanges = changes[sheet.name] ?? {};
  const content = (expanded: boolean) => (
    <PreviewShell
      expanded={expanded}
      wholePage={!expanded || wholeExpanded}
      toolbar={
        <div className="preview-toolbar">
          <span>
            <FileSpreadsheet size={16} />
            原表預覽
          </span>
          <span className="preview-paper-kind">
            A4 · {main ? '主表' : '附表'}
          </span>
          {expanded && (
            <div
              className="preview-zoom-options"
              role="group"
              aria-label="預覽比例"
            >
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={wholeExpanded}
                onClick={() => setWholeExpanded(true)}
              >
                <Maximize size={15} />
                整頁
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={!wholeExpanded}
                onClick={() => setWholeExpanded(false)}
              >
                <ZoomIn size={15} />
                放大
              </Button>
            </div>
          )}
          <Button
            ref={expanded ? undefined : opener}
            variant="ghost"
            size={expanded ? 'icon-sm' : 'sm'}
            aria-label={expanded ? '關閉預覽' : '放大預覽'}
            aria-haspopup={expanded ? undefined : 'dialog'}
            onClick={() => {
              restoreOpener.current = true;
              setWholeExpanded(false);
              setLarge(!expanded);
            }}
          >
            {expanded ? (
              <X size={17} />
            ) : (
              <>
                <ZoomIn size={16} />
                放大
              </>
            )}
          </Button>
        </div>
      }
      tabs={
        manifest.sheets.length > 1 && (
          <div className="paper-tabs">
            {manifest.sheets.map((s, i) => (
              <button
                className={effectivePage === i ? 'active' : ''}
                key={s.name}
                aria-pressed={effectivePage === i}
                onClick={() => setPage(i)}
              >
                {i === 0 ? '旅費報告表' : '交通工具搭乘標準附表'}
              </button>
            ))}
          </div>
        )
      }
      footer={
        errors.length > 0 ? (
          <div className="preview-review-notice" role="status">
            <span>
              <AlertCircle size={16} />
              {errors.length} 項文字需調整
            </span>
            {onReviewIssues && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  restoreOpener.current = false;
                  setLarge(false);
                  onReviewIssues();
                }}
              >
                前往核對
                <ArrowRight size={14} />
              </Button>
            )}
          </div>
        ) : null
      }
    >
      <svg
        className="report-svg"
        viewBox="0 0 595.28 841.89"
        role="img"
        aria-label={
          main
            ? '國立政治大學國外出差旅費報告表，即時原表預覽'
            : '一般版原交通工具搭乘標準附表'
        }
      >
        <rect width="595.28" height="841.89" fill="white" />
        <g
          transform={
            'translate(' +
            (595.28 - xs.at(-1)! * scale) / 2 +
            ',20) scale(' +
            scale +
            ')'
          }
        >
          {sheet.cells.map((cell) => {
            const x = xs[cell.col],
              y = ys[cell.row];
            if (x === undefined || y === undefined) return null;
            const style = manifest.styles[cell.styleIndex],
              font = manifest.fonts[style.fontIndex];
            const merge = sheet.merges.find(
              (m) =>
                cell.row >= m.r1 &&
                cell.row <= m.r2 &&
                cell.col >= m.c1 &&
                cell.col <= m.c2,
            );
            const hidden =
              !!merge && (cell.row !== merge.r1 || cell.col !== merge.c1);
            let width = merge
              ? xs[merge.c2 + 1] - xs[merge.c1]
              : widths[cell.col];
            const height = merge
              ? ys[merge.r2 + 1] - ys[merge.r1]
              : heights[cell.row];
            const changed = Object.hasOwn(cellChanges, cell.address);
            const raw = changed ? cellChanges[cell.address] : cell.value;
            let text =
              raw === null
                ? ''
                : typeof raw === 'object'
                  ? raw.text
                  : String(raw ?? '');
            if (typeof raw === 'number' && /[#,]0/.test(style.numberFormat)) {
              const decimals =
                style.numberFormat.split('.')[1]?.match(/0+/)?.[0].length ?? 0;
              text = raw.toLocaleString('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
              });
              if (style.numberFormat.includes('US$')) text = 'US$' + text;
            }
            if (!merge && !style.wrap && cell.row < 2) width = xs.at(-1)! - x;
            const rawRuns =
              typeof raw === 'object' && raw
                ? raw.runs
                : changed
                  ? undefined
                  : cell.runs;
            const runs =
              rawRuns?.length && rawRuns[0].start > 0
                ? [{ start: 0, fontIndex: style.fontIndex }, ...rawRuns]
                : rawRuns;
            const vertical = style.rotation === 255;
            const capacity =
              style.shrinkToFit && !style.wrap
                ? estimateCellCapacity({ text, runs }, cell, sheet, manifest)
                : null;
            const fontRatio = capacity
              ? Math.min(1, capacity.effectiveFontSize / capacity.fontSize)
              : 1;
            const align =
              style.horizontal === 2 || style.horizontal === 6
                ? 'center'
                : style.horizontal === 3
                  ? 'right'
                  : 'left';
            const b = style.borders;
            return (
              <g key={cell.address} data-cell={cell.address}>
                {style.fill && (
                  <rect
                    x={x}
                    y={y}
                    width={widths[cell.col]}
                    height={heights[cell.row]}
                    fill={style.fill}
                  />
                )}
                {Object.entries(b).map(
                  ([edge, v]) =>
                    v.style > 0 &&
                    (!merge ||
                      (edge === 'left' && cell.col === merge.c1) ||
                      (edge === 'right' && cell.col === merge.c2) ||
                      (edge === 'top' && cell.row === merge.r1) ||
                      (edge === 'bottom' && cell.row === merge.r2)) && (
                      <line
                        key={edge}
                        x1={x + (edge === 'right' ? widths[cell.col] : 0)}
                        y1={y + (edge === 'bottom' ? heights[cell.row] : 0)}
                        x2={x + (edge === 'left' ? 0 : widths[cell.col])}
                        y2={y + (edge === 'top' ? 0 : heights[cell.row])}
                        stroke={v.color || '#000'}
                        strokeWidth={v.style === 2 ? 1.2 : 0.6}
                      />
                    ),
                )}
                {!hidden && text && (
                  <foreignObject x={x} y={y} width={width} height={height}>
                    <div
                      className="cell-layout"
                      style={{
                        ...fontStyle(font, fontRatio),
                        width,
                        height,
                        justifyContent:
                          style.vertical === 0
                            ? 'flex-start'
                            : style.vertical === 2
                              ? 'flex-end'
                              : 'center',
                        textAlign: align,
                        whiteSpace: style.wrap ? 'pre-wrap' : 'pre',
                        overflowWrap: style.wrap ? 'anywhere' : undefined,
                      }}
                    >
                      <PreviewText
                        shrink={(changed || style.shrinkToFit) && !vertical}
                        wrap={style.wrap}
                        align={align}
                        blockAlign={
                          style.vertical === 0
                            ? 'top'
                            : style.vertical === 2
                              ? 'bottom'
                              : 'center'
                        }
                        vertical={vertical}
                      >
                        {runs?.length
                          ? runs.map((r, i) => (
                              <span
                                key={i}
                                style={fontStyle(
                                  manifest.fonts[r.fontIndex],
                                  fontRatio,
                                )}
                              >
                                {text.slice(
                                  r.start,
                                  runs[i + 1]?.start ?? text.length,
                                )}
                              </span>
                            ))
                          : text}
                      </PreviewText>
                    </div>
                  </foreignObject>
                )}
                {!hidden && highlights.has(cell.address) && (
                  <rect
                    className="cell-highlight"
                    x={x + 0.6}
                    y={y + 0.6}
                    width={width - 1.2}
                    height={height - 1.2}
                  />
                )}
              </g>
            );
          })}
          {sheet.drawing &&
            (() => {
              const [a, b] = sheet.drawing.range.split(':').map(address);
              return (
                <foreignObject
                  x={xs[a.col]}
                  y={ys[a.row]}
                  width={xs[b.col + 1] - xs[a.col]}
                  height={ys[b.row + 1] - ys[a.row]}
                >
                  <div
                    className="cell-layout drawing-text"
                    style={{
                      ...fontStyle(
                        manifest.fonts.find((f) => f.name === '標楷體'),
                      ),
                      height: '100%',
                      textAlign: 'center',
                      justifyContent: 'center',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {sheet.drawing.text}
                  </div>
                </foreignObject>
              );
            })()}
        </g>
      </svg>
    </PreviewShell>
  );
  return (
    <>
      {content(false)}
      <dialog
        ref={modal}
        className="preview-dialog preview-workspace-dialog"
        aria-label="原表放大預覽"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], [tabindex="0"]',
            ),
          ].filter((element) => element.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onClose={() => {
          setLarge(false);
          if (restoreOpener.current && opener.current?.isConnected)
            opener.current.focus();
        }}
      >
        {large && content(true)}
      </dialog>
    </>
  );
}
