#!/usr/bin/env node
/** Fetch official CSV with ordinary HTTPS only. Failed updates never replace a snapshot. */
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import {
  BOT_ORIGIN,
  assertIsoDate,
  rejectHtml,
  parseBotCsv,
  quotationDateFromFilename,
  assertQuotationDate,
} from './bot-rates.mjs';

const DEFAULT_DATA = fileURLToPath(new URL('../public/data/', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const taipeiDate = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export async function updateDate(
  date,
  { dataDir = DEFAULT_DATA, fetchImpl = fetch, now = new Date() } = {},
) {
  assertIsoDate(date);
  if (date >= taipeiDate(now))
    throw new Error(
      'CLOSING_DATE_NOT_SETTLED: only dates before today in Taipei are eligible.',
    );
  const sourceUrl = `${BOT_ORIGIN}/xrt/flcsv/0/${date}`;
  const response = await fetchImpl(sourceUrl, {
    signal: AbortSignal.timeout(25000),
    redirect: 'follow',
  });
  if (!response.ok)
    throw new Error(`HTTP_${response.status}: official source unavailable`);
  if (new URL(response.url || sourceUrl).origin !== BOT_ORIGIN)
    throw new Error('Unexpected redirect origin');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000)
    throw new Error('Unexpectedly large rate response');
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('\uFFFD')) text = new TextDecoder('big5').decode(bytes);
  rejectHtml(text, response.headers.get('content-type') || '');
  const quotationDate = quotationDateFromFilename(
    response.headers.get('content-disposition') || '',
  );
  assertQuotationDate(quotationDate, date);
  const parsed = parseBotCsv(text);
  const snapshot = {
    schemaVersion: 1,
    quotationDate,
    quotationKind: 'business-hours-closing',
    baseCurrency: 'TWD',
    unit: 'TWD per 1 foreign currency unit',
    sourceUrl,
    sourceMethod: 'official-csv-https-get',
    retrievedAt: now.toISOString(),
    sha256: sha(bytes),
    hashScope: 'original-response-bytes',
    ...parsed,
  };
  const snapshotPath = resolve(dataDir, 'fx', `${date}.json`);
  try {
    const old = JSON.parse(await readFile(snapshotPath, 'utf8'));
    if (
      old.sha256 === snapshot.sha256 &&
      old.sourceMethod === snapshot.sourceMethod &&
      (await isVerifiedSnapshot(date, dataDir))
    )
      return { date, status: 'unchanged' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Save the verified raw source before publishing the corresponding snapshot.
  const rawPath = resolve(dataDir, 'sources', `bot-${date}.csv`);
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(`${rawPath}.${process.pid}.tmp`, bytes);
  await rename(`${rawPath}.${process.pid}.tmp`, rawPath);
  snapshot.localSourcePath = `sources/bot-${date}.csv`;
  await atomicJson(snapshotPath, snapshot);
  return { date, status: 'updated' };
}

export async function rebuildFxIndex(dataDir = DEFAULT_DATA, now = new Date()) {
  const dir = resolve(dataDir, 'fx');
  await mkdir(dir, { recursive: true });
  const names = (await readdir(dir))
    .filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))
    .sort((a, b) => a.localeCompare(b));
  const availableDates = [],
    snapshots = [],
    currencies = new Set();
  for (const name of names) {
    const value = JSON.parse(await readFile(resolve(dir, name), 'utf8'));
    assertQuotationDate(value.quotationDate, name.slice(0, 10));
    if (!value.currencyRates?.USD?.cashSelling)
      throw new Error(`Invalid existing snapshot: ${name}`);
    availableDates.push(value.quotationDate);
    Object.keys(value.currencyRates).forEach((currency) =>
      currencies.add(currency),
    );
    snapshots.push({
      date: value.quotationDate,
      sha256: value.sha256,
      path: `fx/${name}`,
    });
  }
  const index = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    latestQuotationDate: availableDates.at(-1) ?? null,
    earliestQuotationDate: availableDates[0] ?? null,
    availableDates,
    quotationCount: availableDates.length,
    currencies: [...currencies].sort((a, b) => a.localeCompare(b)),
    snapshots,
    verifiedNonTradingDates: [],
    coverage:
      'Only listed dates are verified snapshots. Missing dates are not proof of bank holidays. Do not select an older snapshot across an unverified missing date.',
  };
  const indexPath = resolve(dir, 'index.json');
  try {
    const old = JSON.parse(await readFile(indexPath, 'utf8'));
    if (
      JSON.stringify({ ...old, generatedAt: null }) ===
      JSON.stringify({ ...index, generatedAt: null })
    )
      return old;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await atomicJson(indexPath, index);
  return index;
}

/** Reuse only snapshots backed by the exact saved official CSV response. */
export async function isVerifiedSnapshot(date, dataDir = DEFAULT_DATA) {
  assertIsoDate(date);
  try {
    const snapshot = JSON.parse(
      await readFile(resolve(dataDir, 'fx', `${date}.json`), 'utf8'),
    );
    assertQuotationDate(snapshot.quotationDate, date);
    if (
      snapshot.sourceMethod !== 'official-csv-https-get' ||
      snapshot.quotationKind !== 'business-hours-closing' ||
      snapshot.sourceUrl !== `${BOT_ORIGIN}/xrt/flcsv/0/${date}` ||
      snapshot.hashScope !== 'original-response-bytes' ||
      snapshot.localSourcePath !== `sources/bot-${date}.csv`
    )
      return false;
    const bytes = await readFile(
      resolve(dataDir, 'sources', `bot-${date}.csv`),
    );
    if (sha(bytes) !== snapshot.sha256) return false;
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('\uFFFD')) text = new TextDecoder('big5').decode(bytes);
    return (
      JSON.stringify(parseBotCsv(text).currencyRates) ===
      JSON.stringify(snapshot.currencyRates)
    );
  } catch {
    return false;
  }
}

export function dateRange(start, end) {
  assertIsoDate(start);
  assertIsoDate(end);
  const days =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86400000 +
    1;
  if (days < 1 || days > 3660)
    throw new Error('Date range must contain 1 to 3660 days');
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransient = (error) =>
  /^(?:HTTP_(?:408|429|5\d\d):|fetch failed$)/.test(error.message) ||
  ['TimeoutError', 'AbortError'].includes(error.name);

export async function runUpdate(dates, options = {}) {
  const {
    concurrency = 1,
    delayMs = 350,
    retries = 1,
    skipCached = false,
    onProgress = () => {},
    sleep = pause,
  } = options;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3)
    throw new Error('Concurrency must be an integer between 1 and 3');
  if (!Number.isFinite(delayMs) || delayMs < 0)
    throw new Error('Request delay must be nonnegative');
  if (!Number.isInteger(retries) || retries < 0 || retries > 3)
    throw new Error('Retries must be an integer between 0 and 3');
  const uniqueDates = [...new Set(dates)].map(assertIsoDate).sort((a, b) => a.localeCompare(b));
  const results = Array.from({ length: uniqueDates.length });
  let cursor = 0,
    completed = 0,
    blocked = false;
  async function worker() {
    while (cursor < uniqueDates.length) {
      const i = cursor++,
        date = uniqueDates[i];
      let result;
      if (blocked) {
        result = {
          date,
          status: 'skipped',
          reason:
            'OFFICIAL_SOURCE_BLOCKED: remaining requests stopped; retry after source is available.',
        };
      } else if (
        skipCached &&
        (await isVerifiedSnapshot(date, options.dataDir))
      ) {
        result = { date, status: 'cached' };
      } else {
        for (let attempt = 0; ; attempt++) {
          try {
            result = await updateDate(date, options);
            break;
          } catch (error) {
            if (
              error.message.startsWith('OFFICIAL_SOURCE_BLOCKED') ||
              /^HTTP_(?:401|403):/.test(error.message)
            )
              blocked = true;
            if (!blocked && isTransient(error) && attempt < retries) {
              await sleep(Math.max(1000, delayMs) * 2 ** attempt);
              continue;
            }
            if (error.message.startsWith('HTTP_429:')) blocked = true;
            result = { date, status: 'failed', reason: error.message };
            break;
          }
        }
        if (cursor < uniqueDates.length && !blocked && delayMs)
          await sleep(delayMs);
      }
      results[i] = result;
      onProgress(result, ++completed, uniqueDates.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Existing snapshots remain intact on each failure; no fake holiday records are generated.
  const index = await rebuildFxIndex(options.dataDir, options.now);
  return {
    results,
    requestedRange: {
      start: uniqueDates[0] ?? null,
      end: uniqueDates.at(-1) ?? null,
    },
    counts: Object.fromEntries(
      ['updated', 'unchanged', 'cached', 'failed', 'skipped'].map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
    earliestQuotationDate: index.earliestQuotationDate,
    latestQuotationDate: index.latestQuotationDate,
    quotationCount: index.quotationCount,
    currencies: index.currencies,
  };
}

export function parseOptions(args, now = new Date()) {
  const values = {};
  const flags = new Set(['--skip-cached', '--refresh-existing']);
  const allowed = new Set([
    '--date',
    '--start',
    '--days',
    '--end',
    '--data-dir',
    '--concurrency',
    '--delay-ms',
  ]);
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) values[args[i]] = true;
    else if (
      allowed.has(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    ) {
      values[args[i]] = args[++i];
    } else
      throw new Error(
        'Usage: node scripts/update-fx.mjs [--date YYYY-MM-DD | --start YYYY-MM-DD --end YYYY-MM-DD | --days 7 --end YYYY-MM-DD] [--skip-cached | --refresh-existing] [--concurrency 1..3] [--delay-ms 350] [--data-dir public/data]',
      );
  }
  if (
    (values['--date'] &&
      (values['--start'] || values['--days'] || values['--end'])) ||
    (values['--start'] && values['--days']) ||
    (values['--skip-cached'] && values['--refresh-existing'])
  )
    throw new Error('Conflicting date or cache options');
  const yesterday = new Date(`${taipeiDate(now)}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const end = assertIsoDate(
    values['--end'] || yesterday.toISOString().slice(0, 10),
  );
  const days = Number(values['--days'] || '7');
  if (!Number.isInteger(days) || days < 1 || days > 3660)
    throw new Error('--days must be an integer between 1 and 3660');
  const start =
    values['--start'] ||
    new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const dates = values['--date']
    ? [assertIsoDate(values['--date'])]
    : dateRange(start, end);
  if (dates.at(-1) >= taipeiDate(now))
    throw new Error(
      'CLOSING_DATE_NOT_SETTLED: only dates before today in Taipei are eligible.',
    );
  const concurrency = Number(values['--concurrency'] || '1');
  const delayMs = Number(values['--delay-ms'] ?? '350');
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 3 ||
    !Number.isFinite(delayMs) ||
    delayMs < 0
  )
    throw new Error(
      'Use concurrency 1 to 3 and a nonnegative delay in milliseconds',
    );
  return {
    dates,
    options: {
      dataDir: values['--data-dir']
        ? resolve(values['--data-dir'])
        : DEFAULT_DATA,
      concurrency,
      delayMs,
      skipCached: values['--refresh-existing']
        ? false
        : Boolean(values['--skip-cached'] || values['--start']),
    },
  };
}

async function cli() {
  const { dates, options } = parseOptions(process.argv.slice(2));
  const result = await runUpdate(dates, {
    ...options,
    onProgress: (entry, done, total) => {
      if (done % 25 === 0 || done === total)
        console.error(`${done}/${total}: ${entry.date} ${entry.status}`);
    },
  });
  console.log(JSON.stringify(result, null, 2));
  // A failed HTTP request cannot distinguish a holiday, source outage, or anti-bot page.
  // Keep a visible CI failure if there were no verified snapshots in this request.
  if (result.results.every((r) => ['failed', 'skipped'].includes(r.status)))
    process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  cli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
