import { requiredDocuments } from '@/lib/required-documents';
import { assetUrl } from '@/lib/paths';
import {
  AlertCircle,
  ArrowRight,
  CheckCheck,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Calculation } from '@/lib/claim/types';
import { Area, CheckField, Field } from './fields';
import type { WorkbenchDraft } from './model';
import { destinationForIssue, type ReviewIssue } from '@/lib/issue-navigation';
import './preview-check.css';

export interface CheckFormProps {
  draft: WorkbenchDraft;
  setDraft: (draft: WorkbenchDraft) => void;
  calculation: Calculation;
  exportIssues?: ReviewIssue[];
  focus: (key: string) => void;
  onNavigate: (tab: string, path?: string) => void;
}
const money = (value: number | null) =>
  value === null ? '待填資料' : `NT$ ${value.toLocaleString('zh-TW')}`;
const exactMoney = (value: string | null) => {
  if (value === null) return '待填資料';
  const [whole, fraction] = value.split('.');
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    (fraction ? `.${fraction}` : '')
  );
};

export function CheckForm({
  draft,
  setDraft,
  calculation,
  exportIssues = [],
  focus,
  onNavigate,
}: CheckFormProps) {
  const documents = requiredDocuments(draft);
  const checkedCount = documents.filter(
    (document) => draft.checkedDocuments?.[document.id],
  ).length;
  const errors = calculation.issues.filter(
    (issue) => issue.severity === 'error',
  );
  const warnings = calculation.issues.filter(
    (issue) => issue.severity === 'warning',
  );
  const information = calculation.issues.filter(
    (issue) => issue.severity === 'info',
  );
  const blockingCount = errors.length + exportIssues.length;
  const update = (key: keyof WorkbenchDraft, value: unknown) =>
    setDraft({ ...draft, [key]: value });
  const goTo = (issue: Pick<ReviewIssue, 'path'>) => {
    const target = destinationForIssue(issue, draft);
    onNavigate(target.tab, issue.path);
    focus(target.focus);
  };
  const rows = calculation.categories.filter(
    (row) =>
      row.category === 'living' ||
      draft.expenses.some((expense) => expense.category === row.category),
  );
  const issueList = (items: ReviewIssue[]) => (
    <div className="issue-list">
      {items.map((issue, index) => (
        <div
          className={`issue-item issue-${issue.severity}`}
          key={`${issue.code}-${issue.path}-${index}`}
        >
          {issue.severity === 'error' ? (
            <AlertCircle size={18} />
          ) : (
            <Info size={18} />
          )}
          <div className="review-issue-content">
            <p>{issue.message}</p>
            {!!issue.relatedFields?.length && (
              <div className="review-related-fields" aria-label="其他相關欄位">
                {issue.relatedFields.map((field) => (
                  <Button
                    key={field.path}
                    variant="link"
                    onClick={() => goTo(field)}
                  >
                    {field.label}
                    <ArrowRight size={14} />
                  </Button>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" onClick={() => goTo(issue)}>
            前往欄位
            <ArrowRight size={14} />
          </Button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="review-form">
      <div className="section-heading">
        <span className="section-symbol">
          <ClipboardCheck />
        </span>
        <div>
          <h2>金額與附件</h2>
        </div>
      </div>
      <div
        className="claim-totals review-claim-totals"
        onFocusCapture={() => focus('total')}
      >
        <div className="review-claim-primary">
          <span>本次申請</span>
          <strong>{money(draft.days.length ? calculation.claimTwd : null)}</strong>
        </div>
        {calculation.claimTwd !== calculation.totalTwd && (
          <div className="review-claim-secondary">
            <span>計算旅費總計</span>
            <strong>{money(calculation.totalTwd)}</strong>
          </div>
        )}
      </div>
      {calculation.totalTwd !== null &&
        calculation.claimTwd !== null &&
        calculation.claimTwd < calculation.totalTwd && (
          <p className="field-hint claim-unclaimed">
            不向本案報支：{money(calculation.totalTwd - calculation.claimTwd)}
            {draft.funding?.shared
              ? '。其他經費依核准分攤表辦理。'
              : '。'}
          </p>
        )}
      <div
        className={`check-status ${blockingCount ? 'needs-attention' : 'fields-complete'}`}
        role="status"
      >
        {blockingCount ? <AlertCircle size={21} /> : <CheckCheck size={21} />}
        <div>
          <strong>
            {blockingCount
              ? `下載前須修正 ${blockingCount} 項`
              : '必填資料已完成，可下載報表。'}
          </strong>
          <p>
            {blockingCount
              ? '請依下方「需修正」項目調整資料。提醒事項不影響下載。'
              : '送件前請完成核對，並備妥所需附件。'}
          </p>
        </div>
      </div>
      {blockingCount > 0 && (
        <section
          className="review-blocking"
          aria-labelledby="review-blocking-heading"
        >
          <h3 id="review-blocking-heading" className="subheading">
            需修正
          </h3>
          {issueList([...errors, ...exportIssues])}
        </section>
      )}
      {warnings.length > 0 && (
        <details className="calculation-details review-warnings">
          <summary>提醒事項 {warnings.length} 項（不影響下載）</summary>
          {issueList(warnings)}
        </details>
      )}
      <details className="calculation-details">
        <summary>各類費用與換算金額</summary>
        <p className="field-hint">
          每一類先按各筆適用匯率精確加總，再四捨五入至臺幣元；生活費先扣除免費供膳宿。
        </p>
        <div className="table-scroll">
          <table className="calculation-table">
            <caption className="sr-only">各類費用換算與四捨五入結果</caption>
            <thead>
              <tr>
                <th scope="col">費用</th>
                <th scope="col">換算後原數額（NT$）</th>
                <th scope="col">列報整數（NT$）</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <th scope="row">{row.label}</th>
                  <td>{exactMoney(row.exactTwd)}</td>
                  <td>
                    {row.twd === null
                      ? '待填資料'
                      : row.twd.toLocaleString('zh-TW')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  合計
                </th>
                <td>
                  {calculation.totalTwd === null
                    ? '待填資料'
                    : calculation.totalTwd.toLocaleString('zh-TW')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
      <details className="calculation-details">
        <summary>查看逐日生活費與每筆費用算式</summary>
        <div className="daily-calculations">
          {calculation.daily.map((day) => (
            <div className="calculation-line" key={day.id}>
              <span>{day.date}</span>
              <div>
                <strong>{day.formula}</strong>
                <small>{day.reason}</small>
              </div>
            </div>
          ))}
        </div>
        {calculation.expenses.length > 0 && (
          <div className="expense-calculations">
            <h4>檢據費用</h4>
            {calculation.expenses.map((expense, index) => (
              <div className="calculation-line" key={expense.id}>
                <span>費用 {index + 1}</span>
                <div>
                  <strong>{expense.formula}</strong>
                  <small>
                    {draft.expenses.find((item) => item.id === expense.id)
                      ?.description || '未填說明'}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </details>
      {information.length > 0 && (
        <details className="calculation-details">
          <summary>查看匯率基準與送件日期</summary>
          <div className="information-list">
            {information.map((issue, index) => (
              <p key={`${issue.code}-${index}`}>{issue.message}</p>
            ))}
          </div>
        </details>
      )}
      <div className="form-divider" />
      <div className="inline-heading">
        <h3 className="subheading">
          <FileCheck2 size={18} />
          應附文件
        </h3>
        <span className="document-count">
          已備妥 {checkedCount}／{documents.length}
        </span>
      </div>
      <p className="field-hint">
        勾選表示文件已備妥，與單據編號、附件張數分開記錄。送件時仍須檢附所需文件。
      </p>
      <div className="document-checks">
        {documents.map((document) => (
          <CheckField
            key={document.id}
            label={document.label}
            hint={document.hint}
            checked={!!draft.checkedDocuments?.[document.id]}
            onChange={(checked) =>
              setDraft({
                ...draft,
                checkedDocuments: {
                  ...draft.checkedDocuments,
                  [document.id]: checked,
                },
              })
            }
          />
        ))}
      </div>
      <div className="form-divider" />
      <h3 className="subheading">單據張數與表格備註</h3>
      <div className="fields">
        <Field
          label="附件單據張數（可稍後補填）"
          path="receiptCount"
          value={draft.receiptCount}
          onChange={(value) => update('receiptCount', value)}
          placeholder="尚未整理可留空"
          hint="依實際附件張數填寫。留空仍可下載，原表保留空格，送件前請補填。"
          onFocus={() => focus('period')}
        />
        <Field
          label="銷差日期"
          path="dischargeDate"
          type="date"
          value={draft.dischargeDate || ''}
          onChange={(value) => update('dischargeDate', value)}
          hint="填寫後提示銷差後 45 日送件提醒，起算與末日順延依主計室核定。"
        />
        <Area
          label="其他備註"
          path="notes"
          value={draft.notes}
          onChange={(value) => update('notes', value)}
          placeholder="補充報支事項、經費分攤或特殊情形"
          hint="會填入原表備註區；請保持精簡，避免超出單頁列印範圍。"
          onFocus={() => focus('notes')}
        />
      </div>
      <details className="details-panel">
        <summary>115 年檢查表與計算來源</summary>
        <p className="field-hint">
          115 年報支檢查表。日支額自 2026 年 1 月 1 日生效。
        </p>
        <div className="source-list">
          {[
            [1, '經費核准與送件'],
            [2, '檢據費用與匯率'],
            [3, '保險及雜費限額'],
            [4, '生活費、供膳宿與返國日'],
          ].map(([page, label]) => (
            <a
              className="source-link"
              key={page}
              target="_blank"
              rel="noreferrer"
              href={
                assetUrl('data/sources/nccu-checklist-115.pdf') +
                '#page=' +
                page
              }
            >
              {label}・第 {page} 頁<ExternalLink size={12} />
            </a>
          ))}
        </div>
      </details>
      <div className="quiet-note">
        <ClipboardCheck size={18} />
        <p>
          下載前請核對姓名、日期與金額；有填寫單據號數時，請確認與附件對應。
        </p>
      </div>
    </div>
  );
}
