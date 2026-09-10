import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseBotCsv } from '../scripts/bot-rates.mjs';

test('published historical rates match their original official CSV bytes and index dates', async () => {
  const root = new URL('../public/data/', import.meta.url);
  const index = JSON.parse(
    await readFile(new URL('fx/index.json', root), 'utf8'),
  );
  assert.ok(
    index.availableDates.length >= 400,
    'Keep the verified 2025–2026 history.',
  );
  assert.equal(new Set(index.availableDates).size, index.availableDates.length);
  assert.deepEqual(index.availableDates, [...index.availableDates].sort((a, b) => a.localeCompare(b)));
  assert.equal(index.earliestQuotationDate, index.availableDates[0]);
  assert.equal(index.latestQuotationDate, index.availableDates.at(-1));
  assert.deepEqual(
    index.snapshots.map((item) => item.date),
    index.availableDates,
  );
  const currencies = new Set();
  for (const entry of index.snapshots) {
    const snapshot = JSON.parse(
      await readFile(new URL(entry.path, root), 'utf8'),
    );
    const bytes = await readFile(new URL(snapshot.localSourcePath, root));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(snapshot.quotationDate, entry.date);
    assert.equal(snapshot.sha256, hash);
    assert.equal(entry.sha256, hash);
    assert.equal(
      snapshot.sourceUrl,
      `https://rate.bot.com.tw/xrt/flcsv/0/${entry.date}`,
    );
    assert.deepEqual(
      snapshot.currencyRates,
      parseBotCsv(bytes.toString('utf8')).currencyRates,
    );
    for (const code of Object.keys(snapshot.currencyRates))
      currencies.add(code);
  }
  assert.deepEqual(index.currencies, [...currencies].sort((a, b) => a.localeCompare(b)));
});
