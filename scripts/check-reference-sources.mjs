#!/usr/bin/env node
/** Alert on official PDF changes without replacing reviewed data or guessing a new effective period. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(
  await readFile(
    new URL('../public/data/source-manifest.json', import.meta.url),
    'utf8',
  ),
);
let failed = false;
for (const source of manifest.sources) {
  try {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.subarray(0, 5).toString() !== '%PDF-')
      throw new Error(
        'Expected PDF; official server returned a different format',
      );
    const hash = createHash('sha256').update(raw).digest('hex');
    if (hash !== source.sha256)
      throw new Error(
        'Official PDF bytes changed; review and version the data before publishing',
      );
    console.log(`${source.id}: unchanged`);
  } catch (error) {
    failed = true;
    console.error(
      `${source.id}: ${error.message}; retained reviewed source and JSON`,
    );
  }
}
if (failed) process.exitCode = 1;
