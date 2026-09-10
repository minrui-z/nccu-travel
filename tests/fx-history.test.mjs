import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dateRange,
  parseOptions,
  runUpdate,
  updateDate,
  isVerifiedSnapshot,
} from '../scripts/update-fx.mjs';
const csv = await readFile(
  new URL('../public/data/sources/bot-2026-01-05.csv', import.meta.url),
  'utf8',
);
const now = new Date('2026-09-09T05:00:00Z');
const response = (date, body = csv, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/csv',
      'content-disposition': `attachment; filename=ExchangeRate@${date.replaceAll('-', '')}1600.csv`,
    },
  });
const dir = () => mkdtemp(join(tmpdir(), 'nccu-history-test-'));

test('History ranges include every requested calendar date with inclusive bounds', () => {
  assert.equal(dateRange('2025-01-01', '2026-09-08').length, 616);
  assert.deepEqual(dateRange('2024-02-28', '2024-03-01'), [
    '2024-02-28',
    '2024-02-29',
    '2024-03-01',
  ]);
  assert.throws(() => dateRange('2026-01-02', '2026-01-01'));
  assert.throws(() => dateRange('2025-02-29', '2025-03-01'));
  assert.throws(() => dateRange('2000-01-01', '2026-01-01'));
});
test('Range CLI defaults to verified cache while daily refresh remains a fresh request', () => {
  const range = parseOptions(
    ['--start', '2025-01-01', '--end', '2026-09-08'],
    now,
  );
  assert.equal(range.dates.length, 616);
  assert.equal(range.options.skipCached, true);
  assert.equal(parseOptions(['--days', '7'], now).options.skipCached, false);
  assert.equal(
    parseOptions(['--days', '366', '--skip-cached'], now).dates.length,
    366,
  );
  assert.equal(
    parseOptions(['--start', '2025-01-01', '--refresh-existing'], now).options
      .skipCached,
    false,
  );
  assert.throws(
    () => parseOptions(['--start', '2025-01-01', '--days', '7'], now),
    /Conflicting/,
  );
  assert.throws(
    () => parseOptions(['--date', '2026-01-05', '--end', '2026-01-06'], now),
    /Conflicting/,
  );
  assert.throws(
    () => parseOptions(['--date', '2026-09-09'], now),
    /NOT_SETTLED/,
  );
  assert.throws(() => parseOptions(['--concurrency', '4'], now));
});
test('Verified raw CSV cache saves network requests and exposes range/currency coverage', async () => {
  const dataDir = await dir();
  await updateDate('2026-01-05', {
    dataDir,
    now,
    fetchImpl: async () => response('2026-01-05'),
  });
  assert.equal(await isVerifiedSnapshot('2026-01-05', dataDir), true);
  let calls = 0;
  const result = await runUpdate(['2026-01-05', '2026-01-05'], {
    dataDir,
    now,
    skipCached: true,
    delayMs: 0,
    fetchImpl: async () => {
      calls++;
      throw Error('Cache must be reused');
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.counts.cached, 1);
  assert.equal(result.quotationCount, 1);
  assert.equal(result.currencies.length, 19);
  assert.equal(result.earliestQuotationDate, '2026-01-05');
  assert.equal(result.latestQuotationDate, '2026-01-05');
});
test('Changed cached bytes or claimed date cannot be reused as verified history', async () => {
  const dataDir = await dir();
  await updateDate('2026-01-05', {
    dataDir,
    now,
    fetchImpl: async () => response('2026-01-05'),
  });
  await writeFile(join(dataDir, 'sources/bot-2026-01-05.csv'), csv + '\n');
  assert.equal(await isVerifiedSnapshot('2026-01-05', dataDir), false);
  let calls = 0;
  const result = await runUpdate(['2026-01-05'], {
    dataDir,
    now,
    skipCached: true,
    delayMs: 0,
    fetchImpl: async () => {
      calls++;
      return response('2026-01-05');
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.results[0].status, 'updated');
  assert.equal(await isVerifiedSnapshot('2026-01-05', dataDir), true);
});
test('Only transient source errors retry; invalid quotation dates are never retried or stored', async () => {
  const dataDir = await dir();
  const calls = new Map();
  const result = await runUpdate(['2026-01-05', '2026-01-06'], {
    dataDir,
    now,
    delayMs: 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      const date = url.slice(-10),
        count = (calls.get(date) || 0) + 1;
      calls.set(date, count);
      if (date === '2026-01-05' && count === 1) return response(date, '', 503);
      return response('2026-01-05');
    },
  });
  assert.equal(calls.get('2026-01-05'), 2);
  assert.equal(calls.get('2026-01-06'), 1);
  assert.equal(result.counts.updated, 1);
  assert.match(result.results[1].reason, /MISMATCH/);
  const index = JSON.parse(
    await readFile(join(dataDir, 'fx/index.json'), 'utf8'),
  );
  assert.deepEqual(index.availableDates, ['2026-01-05']);
  assert.deepEqual(index.verifiedNonTradingDates, []);
});
test('A validation page stops a long history job without repeated requests', async () => {
  const dataDir = await dir();
  let calls = 0;
  const result = await runUpdate(dateRange('2026-01-01', '2026-01-31'), {
    dataDir,
    now,
    delayMs: 0,
    fetchImpl: async () => {
      calls++;
      return response('2026-01-01', '<html>Challenge Validation</html>');
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.skipped, 30);
  assert.equal(result.quotationCount, 0);
});
test('Backfill bounds concurrent network requests to three and keeps ordered results', async () => {
  const dataDir = await dir();
  let active = 0,
    maximum = 0;
  const dates = dateRange('2026-01-01', '2026-01-09');
  const result = await runUpdate(dates, {
    dataDir,
    now,
    delayMs: 0,
    concurrency: 3,
    fetchImpl: async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return response(url.slice(-10));
    },
  });
  assert.equal(maximum, 3);
  assert.deepEqual(
    result.results.map((entry) => entry.date),
    dates,
  );
  assert.equal(result.counts.updated, dates.length);
});

test('Access denial and exhausted rate-limit retry stop the remaining range', async () => {
  for (const status of [403, 429]) {
    const dataDir = await dir();
    let calls = 0;
    const result = await runUpdate(dateRange('2026-01-01', '2026-01-03'), {
      dataDir,
      now,
      delayMs: 0,
      sleep: async () => {},
      fetchImpl: async () => {
        calls++;
        return response('2026-01-01', '', status);
      },
    });
    assert.equal(calls, status === 429 ? 2 : 1);
    assert.equal(result.counts.failed, 1);
    assert.equal(result.counts.skipped, 2);
  }
});
