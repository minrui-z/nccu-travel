import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPaneHeight, previewPaperWidth } from '../lib/preview-viewport';

test('whole A4 stays inside the available 1400 and 1280 desktop viewport', () => {
  for (const [viewportHeight, top, width] of [
    [900, 198, 670],
    [800, 198, 610],
  ]) {
    const pane = previewPaneHeight(viewportHeight, top, 20);
    const surfaceHeight = pane - 48 - 36 - 36;
    const paperWidth = previewPaperWidth(width - 36, surfaceHeight, true);
    assert.ok(paperWidth > 0);
    assert.ok(paperWidth <= width - 36);
    assert.ok((paperWidth * 841.89) / 595.28 <= surfaceHeight + 0.001);
    assert.equal(top + pane + 20, viewportHeight);
  }
});

test('scrolling respects the sticky offset and enlargement changes view scale only', () => {
  assert.equal(previewPaneHeight(800, -100, 84), 696);
  assert.equal(previewPaperWidth(600, 500, false), 840);
  assert.equal(previewPaperWidth(1000, 500, false), 1000);
  assert.equal(previewPaperWidth(0, 0, true), 0);
});
