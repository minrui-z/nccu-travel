export type ReportErrorCode = 'invalid-claim' | 'layout' | 'template' | 'file' | 'timeout';
const messages: Record<ReportErrorCode, string> = {
  'invalid-claim': '資料尚未填妥，請前往「檢查與下載」查看需要修改的欄位。',
  layout: '部分內容無法放入報表，請前往「檢查與下載」調整。',
  template: '報表載入失敗，請檢查連線後重試。',
  file: '報表無法產生，請重新載入後再試。草稿會保留在此瀏覽器。',
  timeout: '產生報表的時間較長，請重試。',
};
export function reportErrorMessage(code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code as ReportErrorCode] : messages.file;
}
