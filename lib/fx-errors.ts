/** Errors intentionally written for the form, separate from parser diagnostics. */
export class FxInputError extends Error {}

export function fxImportError(error: unknown): string {
  if (error instanceof FxInputError) return error.message;
  const message = error instanceof Error ? error.message : '';
  const mismatch = message.match(
    /QUOTATION_DATE_MISMATCH: requested (\d{4}-\d{2}-\d{2}), received (\d{4}-\d{2}-\d{2})/,
  );
  if (mismatch)
    return `檔案報價日期為 ${mismatch[2]}，與填寫的 ${mismatch[1]} 不同，請核對後重新匯入。`;
  if (message.includes('OFFICIAL_SOURCE_BLOCKED'))
    return '選取的檔案不是匯率資料，請從臺灣銀行重新下載匯率檔（CSV）。';
  if (
    message.includes('MANUAL_DATE_PROOF_REQUIRED') ||
    message.includes('MISSING_QUOTATION_DATE')
  )
    return '請填寫報價日期，並依臺銀下載頁或匯率證明核對檔案日期。';
  if (message.includes('Invalid calendar date'))
    return '報價日期不正確，請重新選擇日期。';
  return '無法讀取這份匯率檔，請重新下載臺灣銀行原始 CSV 檔後再試。';
}

export function fxLookupError(error: unknown): string {
  if (error instanceof FxInputError) return error.message;
  return '暫時無法取得匯率，請重試，或匯入臺銀匯率檔並核對報價日期。';
}
