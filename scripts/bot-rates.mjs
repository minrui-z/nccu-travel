/** Bank of Taiwan public closing-rate readers. No network or Node-only APIs. */
export const BOT_ORIGIN = 'https://rate.bot.com.tw';

export function assertIsoDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return value;
}

export function rejectHtml(text, contentType = '') {
  if (
    /html/i.test(contentType) ||
    /<\s*(?:!doctype|html|head|body|script)\b/i.test(text) ||
    /Challenge Validation|captcha|access denied/i.test(text)
  ) {
    throw new Error(
      'OFFICIAL_SOURCE_BLOCKED: response is HTML or a validation page, not exchange-rate data.',
    );
  }
}

/** RFC 4180 quoting, optional BOM, CRLF, trailing empty columns. */
export function parseCsv(text) {
  rejectHtml(text);
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field.trim()) throw new Error('Invalid CSV quote');
      quoted = true;
    } else if (c === ',') {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows.map((r) => {
    while (r.at(-1) === '') r.pop();
    return r;
  });
}

function rate(value) {
  value = String(value ?? '')
    .trim()
    .replaceAll(',', '');
  if (value === '' || value === '-' || /^0+(?:\.0+)?$/.test(value)) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0)
    throw new Error(`Invalid exchange rate: ${value}`);
  return value;
}

function parseRows(rows, { minCurrencies = 15 } = {}) {
  if (rows.length < 2) throw new Error('Empty exchange-rate table');
  const header = rows[0].map((x) => x.replace(/\s/g, '').toLowerCase());
  if (!['currency', '幣別'].includes(header[0]))
    throw new Error('Unknown BOT currency header');
  const rateColumns = header.flatMap((h, i) =>
    ['rate', '匯率'].includes(h) ? [i] : [],
  );
  if (rateColumns.length !== 2)
    throw new Error('Expected distinct Buying and Selling column groups');
  const [buy, sell] = rateColumns;
  for (const i of [buy, sell]) {
    if (
      !['cash', '現金'].includes(header[i + 1]) ||
      !['spot', '即期'].includes(header[i + 2])
    ) {
      throw new Error('Unknown BOT cash/spot column order');
    }
  }
  const currencyRates = {};
  for (const row of rows.slice(1)) {
    if (row.length !== header.length)
      throw new Error('Unexpected BOT table width');
    const currency = row[0].trim().match(/^(?:.*\()?([A-Z]{3})\)?$/)?.[1];
    if (!currency || currencyRates[currency])
      throw new Error('Invalid or duplicate currency');
    if (
      !/^(Buying|本行買入|買入)$/i.test(row[buy]) ||
      !/^(Selling|本行賣出|賣出)$/i.test(row[sell])
    ) {
      throw new Error('Unexpected BOT buy/sell labels');
    }
    currencyRates[currency] = {
      cashBuying: rate(row[buy + 1]),
      spotBuying: rate(row[buy + 2]),
      cashSelling: rate(row[sell + 1]),
      spotSelling: rate(row[sell + 2]),
    };
  }
  if (
    Object.keys(currencyRates).length < minCurrencies ||
    !currencyRates.USD?.cashSelling ||
    !currencyRates.USD?.spotSelling
  ) {
    throw new Error('Incomplete BOT currency table or missing USD rates');
  }
  return { currencyRates };
}

export function parseBotCsv(text, options) {
  return parseRows(parseCsv(text), options);
}
export function parseBotText(text, options) {
  rejectHtml(text);
  const rows = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/));
  return parseRows(rows, options);
}

/** Date evidence must come from the server's download name, not the requested URL. */
export function quotationDateFromFilename(filename) {
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    /* Plain filenames also work. */
  }
  const match = decoded.match(
    /ExchangeRate@(\d{4})(\d{2})(\d{2})(?:\d{4,6})?/i,
  );
  if (!match)
    throw new Error(
      'MISSING_QUOTATION_DATE: official download filename has no recognized quotation timestamp.',
    );
  return assertIsoDate(`${match[1]}-${match[2]}-${match[3]}`);
}

export function assertQuotationDate(actual, requested) {
  assertIsoDate(actual);
  assertIsoDate(requested);
  if (actual !== requested)
    throw new Error(
      `QUOTATION_DATE_MISMATCH: requested ${requested}, received ${actual}.`,
    );
}

/** A date-free upload is manual evidence, never an automatically verified quote. */
export function parseBotCsvImport(
  text,
  { filename = '', targetDate, dateProofConfirmed = false, ...options } = {},
) {
  const parsed = parseBotCsv(text, options);
  let quotationDate;
  try {
    quotationDate = quotationDateFromFilename(filename);
  } catch {
    if (!targetDate || !dateProofConfirmed)
      throw new Error(
        'MANUAL_DATE_PROOF_REQUIRED: enter the quotation date and confirm it against official evidence.',
      );
    quotationDate = assertIsoDate(targetDate);
    return {
      ...parsed,
      quotationDate,
      sourceMethod: 'user-import-with-manual-date-proof',
      dateProofConfirmed: true,
    };
  }
  if (targetDate) assertQuotationDate(quotationDate, targetDate);
  return {
    ...parsed,
    quotationDate,
    sourceMethod: 'user-import-with-filename-date',
    dateProofConfirmed: false,
  };
}
