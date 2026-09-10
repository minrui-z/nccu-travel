import { useRef, useState } from 'react';
import { parseBotCsvImport } from '@/scripts/bot-rates.mjs';
import { CheckField } from './fields';
import { FxInputError, fxImportError } from '@/lib/fx-errors';
export interface ExpenseCsvQuote {
  date: string;
  rate: string;
  source: 'bot-cash' | 'bot-spot';
  proof: string;
  cashUnavailable: boolean;
}
export function ExpenseCsv({
  date,
  currency,
  context,
  onImported,
}: {
  date: string;
  currency: string;
  context: string;
  onImported: (quote: ExpenseCsvQuote) => void;
}) {
  const [confirmedFor, setConfirmedFor] = useState(''),
    [message, setMessage] = useState('');
  const confirmationKey = date + '|' + currency;
  const confirmed = confirmedFor === confirmationKey;
  const latest = useRef({ date, currency, context });
  latest.current = { date, currency, context };
  const read = async (file: File) => {
    try {
      if (!date || !confirmed)
        throw new FxInputError('請先填寫報價日期，並確認與檔案日期一致。');
      if (file.size > 1000000)
        throw new FxInputError('檔案超過 1 MB，請選擇臺灣銀行原始匯率檔。');
      const data = parseBotCsvImport(await file.text(), {
        filename: file.name,
        targetDate: date,
        dateProofConfirmed: confirmed,
      });
      const quote = data.currencyRates[currency];
      const rate = quote?.cashSelling ?? quote?.spotSelling;
      if (!rate)
        throw new FxInputError(
          '這份匯率檔沒有 ' +
            currency +
            ' 的有效賣出報價，請使用適用官方資料。',
        );
      if (
        latest.current.date !== date ||
        latest.current.currency !== currency ||
        latest.current.context !== context
      )
        throw new FxInputError('日期或幣別已更改，請重新匯入。');
      onImported({
        date: data.quotationDate,
        rate,
        source: quote.cashSelling ? 'bot-cash' : 'bot-spot',
        proof:
          '臺灣銀行匯率檔：' +
          file.name +
          '；報價日期已核對' +
          (quote.cashSelling ? '' : '；此幣別無現金賣出'),
        cashUnavailable: !quote.cashSelling,
      });
      setMessage(
        '已匯入 ' +
          data.quotationDate +
          ' ' +
          currency +
          ' 賣出匯率 ' +
          rate +
          '。',
      );
    } catch (e) {
      setMessage(fxImportError(e));
    }
  };
  return (
    <details className="details-panel">
      <summary>匯入臺銀匯率檔（CSV）</summary>
      <CheckField
        label="已確認檔案的報價日期與上方日期一致"
        checked={confirmed}
        onChange={(value) => setConfirmedFor(value ? confirmationKey : '')}
      />
      <label className="file-input-label">
        選擇匯率檔
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label={'匯入 ' + currency + ' 臺銀匯率檔（CSV）'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
      </label>
      {message && (
        <p role="status" className="field-hint">
          {message}
        </p>
      )}
    </details>
  );
}
