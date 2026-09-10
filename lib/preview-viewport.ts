const A4_RATIO = 595.28 / 841.89;

/** Scale the A4 view, never the report's cell geometry or text styles. */
export function previewPaperWidth(
  width: number,
  height: number,
  wholePage: boolean,
): number {
  const availableWidth = Math.max(0, width);
  const availableHeight = Math.max(0, height);
  return wholePage
    ? Math.min(availableWidth, availableHeight * A4_RATIO)
    : Math.max(840, availableWidth);
}

export function previewPaneHeight(
  viewportHeight: number,
  top: number,
  stickyTop: number,
): number {
  return Math.max(240, viewportHeight - Math.max(stickyTop, top) - 20);
}
