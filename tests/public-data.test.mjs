import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseBotText,
  parseBotCsv,
  parseBotCsvImport,
  quotationDateFromFilename,
  assertQuotationDate,
  assertIsoDate,
} from '../scripts/bot-rates.mjs';
import { updateDate, runUpdate } from '../scripts/update-fx.mjs';
const realText = await readFile(
  new URL(
    '../public/data/sources/bot-2026-01-05-extracted.txt',
    import.meta.url,
  ),
  'utf8',
);
const realCsv = await readFile(
  new URL('../public/data/sources/bot-2026-01-05.csv', import.meta.url),
  'utf8',
);
// CSV representation generated from the verified official plaintext data, not an alleged raw CSV response.
const csv = realText
  .replace(/^\uFEFF/, '')
  .trim()
  .split(/\r?\n/)
  .map((l) =>
    l
      .trim()
      .split(/\s+/)
      .map((v) => `"${v}"`)
      .join(','),
  )
  .join('\r\n');
const now = new Date('2026-01-08T12:00:00Z');
function response(
  body = csv,
  filename = 'ExchangeRate@202601051601.csv',
  type = 'text/csv',
) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename=${filename}`,
    },
  });
}

test('Official 19-currency plaintext sample and equivalent CSV agree', () => {
  const actual = parseBotText(realText);
  assert.equal(Object.keys(actual.currencyRates).length, 19);
  assert.deepEqual(parseBotCsv('\uFEFF' + csv), actual);
  assert.deepEqual(parseBotCsv(realCsv), actual);
  assert.equal(actual.currencyRates.USD.cashSelling, '31.81000');
  assert.equal(actual.currencyRates.USD.spotSelling, '31.59000');
  assert.equal(actual.currencyRates.JPY.cashSelling, '0.20440');
  assert.equal(actual.currencyRates.ZAR.cashSelling, null);
  assert.equal(actual.currencyRates.KRW.spotSelling, null);
});
test('Chinese column names and buy/sell labels preserve direction', () => {
  const chinese = csv
    .replaceAll('Currency', '幣別')
    .replaceAll('Rate', '匯率')
    .replaceAll('Cash', '現金')
    .replaceAll('Spot', '即期')
    .replaceAll('Buying', '本行買入')
    .replaceAll('Selling', '本行賣出');
  assert.deepEqual(parseBotCsv(chinese), parseBotText(realText));
});
test('Missing, duplicate, invalid and partial rate tables fail', () => {
  assert.throws(
    () => parseBotCsv(csv.split('\r\n').slice(0, 2).join('\r\n')),
    /Incomplete/,
  );
  assert.throws(
    () => parseBotCsv(csv + '\r\n' + csv.split('\r\n')[1]),
    /duplicate/,
  );
  assert.throws(
    () => parseBotCsv(csv.replace('31.81000', '-31.81000')),
    /Invalid exchange/,
  );
  assert.throws(
    () => parseBotCsv('<!DOCTYPE html><title>Challenge Validation</title>'),
    /BLOCKED/,
  );
});
test('Quotation date is validated rather than inferred from request', () => {
  assert.equal(
    quotationDateFromFilename(
      'attachment; filename=ExchangeRate@202601051601.csv',
    ),
    '2026-01-05',
  );
  assert.throws(
    () => quotationDateFromFilename('rates.csv'),
    /MISSING_QUOTATION_DATE/,
  );
  assert.throws(
    () => assertQuotationDate('2026-01-05', '2026-01-06'),
    /MISMATCH/,
  );
  assert.throws(() => assertIsoDate('2026-02-30'));
});
test('Date-free user CSV requires explicit date and official proof confirmation', () => {
  assert.throws(
    () =>
      parseBotCsvImport(csv, {
        filename: 'rates.csv',
        targetDate: '2026-01-05',
      }),
    /MANUAL_DATE_PROOF_REQUIRED/,
  );
  const result = parseBotCsvImport(csv, {
    filename: 'rates.csv',
    targetDate: '2026-01-05',
    dateProofConfirmed: true,
  });
  assert.equal(result.sourceMethod, 'user-import-with-manual-date-proof');
  assert.throws(
    () =>
      parseBotCsvImport(csv, {
        filename: 'ExchangeRate@202601051601.csv',
        targetDate: '2026-01-06',
      }),
    /MISMATCH/,
  );
});
test('Successful ordinary CSV fetch writes verified source and snapshot', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'nccu-fx-good-'));
  const result = await updateDate('2026-01-05', {
    dataDir,
    now,
    fetchImpl: async () => response(),
  });
  assert.equal(result.status, 'updated');
  const written = JSON.parse(
    await readFile(join(dataDir, 'fx/2026-01-05.json'), 'utf8'),
  );
  assert.equal(written.currencyRates.USD.cashSelling, '31.81000');
  assert.equal(written.quotationDate, '2026-01-05');
  assert.equal(
    await readFile(join(dataDir, 'sources/bot-2026-01-05.csv'), 'utf8'),
    csv,
  );
});
test('HTTP 200 validation HTML and wrong quote dates preserve existing snapshot bytes', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'nccu-fx-preserve-'));
  await mkdir(join(dataDir, 'fx'));
  const old = JSON.stringify({
    schemaVersion: 1,
    quotationDate: '2026-01-05',
    currencyRates: parseBotText(realText).currencyRates,
  });
  const path = join(dataDir, 'fx/2026-01-05.json');
  await writeFile(path, old);
  for (const mock of [
    () =>
      response(
        '<html><title>Challenge Validation</title></html>',
        'ExchangeRate@202601051601.csv',
        'text/html',
      ),
    () => response(csv, 'ExchangeRate@202601061601.csv'),
    () => response(csv, 'rates.csv'),
  ]) {
    const result = await runUpdate(['2026-01-05'], {
      dataDir,
      now,
      fetchImpl: async () => mock(),
    });
    assert.equal(result.results[0].status, 'failed');
    assert.equal(await readFile(path, 'utf8'), old);
  }
  const index = JSON.parse(
    await readFile(join(dataDir, 'fx/index.json'), 'utf8'),
  );
  assert.deepEqual(index.availableDates, ['2026-01-05']);
  assert.deepEqual(index.verifiedNonTradingDates, []);
});
test('Current or future date cannot be mislabeled as a settled closing rate', async () => {
  await assert.rejects(
    updateDate('2026-01-08', {
      now,
      fetchImpl: async () => {
        throw Error('must not fetch');
      },
    }),
    /CLOSING_DATE_NOT_SETTLED/,
  );
});
