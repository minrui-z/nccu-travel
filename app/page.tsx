import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, ArrowDownToLine, LoaderCircle, ArrowLeft, ArrowRight, ExternalLink, X, MoreHorizontal, BookOpen, CircleHelp, Eye, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { createEmptyDraft, calculateClaim } from '@/lib/claim/claim-engine';
import { loadAllowances, loadInsurance, type Allowances, type InsuranceData, type FxIndex } from '@/lib/public-data';
import { assetUrl, fetchJson } from '@/lib/paths';
import { PersonForm } from './person-form';
import { TripForm } from './trip-form';
import { ExpenseForm } from './expense-form';
import { CheckForm } from './check-form';
import { ReportPreview } from './report-preview';
import { ConfirmChange } from './confirm-change';
import { useDraft } from './use-draft';
import { useReport } from './use-report';
import { registerClaimTools } from './webmcp';
import { FieldIssues } from './fields';
import { destinationForIssue, fieldPathCandidates } from '@/lib/issue-navigation';
import { reportErrorMessage } from '@/lib/report-errors';
import { useExpenseFxAutoFill } from './use-expense-fx-auto-fill';
import './product-flow.css';

const ExamplePage = lazy(() => import('./example-page'));
const steps = [ ['person', '基本資料'], ['trip', '行程與生活費'], ['cost', '費用'], ['check', '檢查與下載'] ] as const;
const money = (amount: number | null) => amount === null ? '—' : amount.toLocaleString('zh-TW');

export default function App() {
  const example = new URLSearchParams(window.location.search).get('example');
  return example === 'general' || example === 'student'
    ? <Suspense fallback={<div className="empty-state">載入填寫範例…</div>}><ExamplePage initialTemplate={example} /></Suspense>
    : <Workbench />;
}
function Workbench() {
  const { draft, setDraft, replaceDraft, restoreDraft, hasPrevious, ready, replacing, saveState, saveStatus, announcement, retrySave } = useDraft();
  const fxAutoFill = useExpenseFxAutoFill(draft, setDraft);
  const [tab, setTab] = useState('person');
  const [focus, setFocus] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'restore' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [allowances, setAllowances] = useState<Allowances | null>(null);
  const [insurance, setInsurance] = useState<InsuranceData | null>(null);
  const [fxInfo, setFxInfo] = useState<FxIndex | null>(null);
  const [dataError, setDataError] = useState('');
  const [retry, setRetry] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [visited, setVisited] = useState<string[]>([]);
  const [touched, setTouched] = useState<string[]>([]);
  const [pendingField, setPendingField] = useState<{ path: string } | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const helpRef = useRef<HTMLDetailsElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    const closeOnFocusChange = (event: FocusEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current?.open) {
        menuRef.current.open = false;
        menuRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    document.addEventListener('focusin', closeOnFocusChange);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
      document.removeEventListener('focusin', closeOnFocusChange);
    };
  }, []);
  const calculation = useMemo(() => calculateClaim(draft), [draft]);
  const { manifest, mapped, error: templateError } = useReport(draft, calculation, retry);
  const issues = useMemo(() => [...calculation.issues, ...mapped.errors], [calculation.issues, mapped.errors]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const visibleIssues = issues.filter((issue) => showErrors || visited.includes(destinationForIssue(issue, draft).tab) || touched.includes(issue.path));
  const currentStep = steps.findIndex(([key]) => key === tab);
  const calculationRef = useRef(calculation);
  calculationRef.current = calculation;
  useEffect(() => registerClaimTools(() => calculationRef.current), []);

  useEffect(() => {
    if (!pendingField || !editorRef.current) return;
    let stopped = false;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      if (stopped || !editorRef.current) return;
      const fields = [...editorRef.current.querySelectorAll<HTMLElement>('[data-field-path]')].filter((field) => !field.closest('[data-slot="tabs-content"][hidden]'));
      const target = fieldPathCandidates(pendingField.path).map((path) => fields.find((field) => field.dataset.fieldPath === path)).find(Boolean);
      if (!target && attempts++ < 12) { frame = requestAnimationFrame(reveal); return; }
      if (!target) { setPendingField(null); return; }
      let parent = target.parentElement;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      const control = target.querySelector<HTMLElement>('input:not(:disabled), textarea, button:not(:disabled), [tabindex="0"]') ?? target;
      control.focus({ preventScroll: true });
      setPendingField(null);
    };
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reveal); });
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [pendingField, tab]);

  useEffect(() => {
    let alive = true;
    setDataError('');
    void Promise.allSettled([loadAllowances(), loadInsurance(), fetchJson<FxIndex>('data/fx/index.json')]).then(([a, i, f]) => {
      if (!alive) return;
      if (a.status === 'fulfilled') setAllowances(a.value);
      if (i.status === 'fulfilled') setInsurance(i.value);
      if (f.status === 'fulfilled') setFxInfo(f.value);
      if ([a, i, f].some((value) => value.status === 'rejected')) setDataError('部分日支額、保費或匯率資料未能載入，請檢查連線後重試。');
    });
    return () => { alive = false; };
  }, [retry]);

  const navigate = (next: string, path?: string) => {
    scrollPositions.current[tab] = window.scrollY;
    setVisited((previous) => [...new Set([...previous, tab])]);
    setTab(next);
    setMobilePreview(false);
    if (path) {
      setShowErrors(true);
      setFocus(destinationForIssue({ path }, draft).focus);
      setPendingField({ path });
    } else requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[next] ?? 0, behavior: 'instant' })));
  };
  const download = async () => {
    if (!ready || replacing || exporting) return;
    if (!manifest) { setMessage(templateError || '報表載入中，請稍候再下載。'); return; }
    if (!calculation.canExport || mapped.errors.length) {
      setShowErrors(true);
      navigate('check');
      setMessage(`還有 ${errors.length} 項資料需要修改，請依下方提示補齊。`);
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    setExporting(true);
    setMessage('正在產生報表…');
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('../lib/xls/export.worker.ts', import.meta.url), { type: 'module' });
      const exportWorker = worker;
      const response = await fetch(assetUrl('templates/' + manifest.file));
      if (!response.ok) throw 'template';
      const template = await response.arrayBuffer();
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const timeout = setTimeout(() => reject('timeout'), 30000);
        exportWorker.onmessage = (event) => {
          clearTimeout(timeout);
          if (event.data.error) reject(event.data.error);
          else if (event.data.buffer instanceof ArrayBuffer) resolve(event.data.buffer);
          else reject('file');
        };
        exportWorker.onerror = () => { clearTimeout(timeout); reject('file'); };
        exportWorker.postMessage({ draft, manifest, template }, [template]);
      });
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.ms-excel' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `政大國外旅費_${draft.template === 'general' ? '一般版' : '學生版'}_${draft.startDate}.xls`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage('報表已產生。');
    } catch (code) { setMessage(reportErrorMessage(code)); }
    finally { worker?.terminate(); setExporting(false); }
  };
  const statusForStep = (key: string) => {
    const count = errors.filter((issue) => destinationForIssue(issue, draft).tab === key).length;
    if (count) return visited.includes(key) || showErrors ? { label: '需修正', state: 'error' } : { label: '尚未完成', state: 'pending' };
    return { label: '已完成', state: 'complete' };
  };
  const openHelp = () => {
    setHelpOpen(true);
    requestAnimationFrame(() => helpRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' }));
  };
  return (
    <div className="workbench product-workbench">
      <header className="app-header">
        <a className="brand" href="./"><span className="brand-icon"><FileSpreadsheet size={23} /></span><div><h1 className="brand-title">差旅報帳</h1><span className="brand-sub">政大國外出差 · 115 年版</span></div></a>
        <div className={`draft-state ${saveStatus === 'error' || saveStatus === 'paused' ? 'save-error' : ''}`} title="資料只儲存在此瀏覽器"><span />{saveStatus === 'error' || saveStatus === 'paused' ? '草稿需處理' : saveState}</div>
        <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
        <details className="workspace-menu" ref={menuRef}>
          <summary aria-label="更多操作"><MoreHorizontal size={21} /></summary>
          <div className="workspace-menu-content">
            <a href={`?example=${draft.template}`} target="_blank" rel="noreferrer"><BookOpen size={16} />查看填寫範例<ExternalLink size={13} /></a>
            <button onClick={() => { if (menuRef.current) menuRef.current.open = false; openHelp(); }}><CircleHelp size={16} />使用說明與規則</button>
            {hasPrevious && <button disabled={!ready || replacing} onClick={() => { setConfirm('restore'); if (menuRef.current) menuRef.current.open = false; }}>恢復上一份草稿</button>}
            <button disabled={!ready || replacing} onClick={() => { setConfirm('reset'); if (menuRef.current) menuRef.current.open = false; }}>重新填寫</button>
          </div>
        </details>
        <Button className="download-button" onClick={download} disabled={!ready || exporting || replacing} title="下載 Excel（.xls）報帳表">{exporting ? <LoaderCircle className="spin" /> : <ArrowDownToLine />}{exporting ? '產生中…' : '下載報帳表'}</Button>
      </header>
      {(saveStatus === 'error' || saveStatus === 'paused') && <div className="page-notice error" role="alert">{saveState}{saveStatus === 'error' && <Button size="sm" variant="outline" onClick={retrySave}>重試儲存</Button>}</div>}
      {message && <div className="page-notice" role="status">{message}<button aria-label="關閉訊息" onClick={() => setMessage('')}><X size={18} /></button></div>}
      {(dataError || templateError) && <div className="page-notice error" role="alert">{dataError || templateError}<Button variant="outline" size="sm" onClick={() => setRetry(retry + 1)}>重試</Button></div>}
      <div className="compact-preview-switch"><Button variant="outline" onClick={() => setMobilePreview(!mobilePreview)}><Eye size={16} />{mobilePreview ? '返回填寫' : '查看報表預覽'}</Button></div>
      <main className={`workspace ${mobilePreview ? 'show-preview' : ''}`}>
        <section ref={editorRef} className="editor" aria-label="旅費輸入" inert={replacing} onBlurCapture={(event) => {
          const path = (event.target as HTMLElement).closest<HTMLElement>('[data-field-path]')?.dataset.fieldPath;
          if (path) setTouched((previous) => previous.includes(path) ? previous : [...previous, path]);
        }}>
          <FieldIssues value={visibleIssues}>
            <Tabs value={tab} onValueChange={(value) => navigate(String(value))}>
              <TabsList className="section-tabs" aria-label="填報步驟">{steps.map(([key, label], index) => {
                const state = statusForStep(key);
                return <TabsTrigger value={key} key={key} aria-label={`${label}，${state.label}`}><span className="step-number">{index + 1}</span><span className="step-copy">{label}<small className={`step-state ${state.state}`}>{state.state === 'complete' && <Check size={10} />}{state.label}</small></span></TabsTrigger>;
              })}</TabsList>
              <div aria-busy={!ready}>{!ready ? <div className="empty-state">讀取草稿…</div> : <>
                <TabsContent value="person" keepMounted><PersonForm draft={draft} setDraft={setDraft} focus={setFocus} /></TabsContent>
                <TabsContent value="trip" keepMounted><TripForm draft={draft} setDraft={setDraft} allowances={allowances} fxInfo={fxInfo} calculation={calculation} focus={setFocus} requestedPath={pendingField?.path} /></TabsContent>
                <TabsContent value="cost" keepMounted><ExpenseForm draft={draft} setDraft={setDraft} insurance={insurance} focus={setFocus} fxAutoFill={fxAutoFill} requestedPath={pendingField?.path} /></TabsContent>
                <TabsContent value="check" keepMounted><CheckForm draft={draft} setDraft={setDraft} calculation={calculation} focus={setFocus} onNavigate={navigate} exportIssues={mapped.errors} /></TabsContent>
              </>}</div>
            </Tabs>
          </FieldIssues>
          <div className="step-navigation">{currentStep > 0 ? <Button variant="ghost" onClick={() => navigate(steps[currentStep - 1][0])}><ArrowLeft size={16} />上一步</Button> : <span />}{currentStep < steps.length - 1 ? <Button variant="outline" onClick={() => navigate(steps[currentStep + 1][0])}>下一步<ArrowRight size={16} /></Button> : <span className="download-hint">完成後可由右上方下載 Excel（.xls）</span>}</div>
          <div className="editor-summary">
            <div><span>本次申請金額</span><strong><small>NT$</small> {money(draft.days.length ? calculation.claimTwd : null)}</strong></div>
            <div className="summary-secondary">{calculation.totalTwd !== null && calculation.claimTwd !== null && calculation.totalTwd !== calculation.claimTwd && <><span>計算旅費 NT$ {money(calculation.totalTwd)}</span><span>不向本案報支 NT$ {money(calculation.totalTwd - calculation.claimTwd)}</span></>}<button onClick={() => navigate('check')}>查看計算與附件<ArrowRight size={14} /></button></div>
          </div>
        </section>
        <ReportPreview manifest={mapped.manifest} changes={mapped.changes} draft={draft} focused={focus} errors={mapped.errors} onReviewIssues={() => navigate('check')} />
      </main>
      <footer className="app-footer product-footer">
        <details ref={helpRef} open={helpOpen} onToggle={(event) => setHelpOpen(event.currentTarget.open)}><summary>使用說明與規則<CircleHelp size={15} /></summary><div className="help-content">
          <p>姓名、行程與費用只儲存在目前瀏覽器。下載後的報帳表為 Excel（.xls）檔案；送件前請確認附件與列印內容。</p>
          <p>可以先填寫任一步驟，再返回補齊資料。「檢查與下載」中的提示可直接前往相關欄位。核准及應備文件仍請依實際案件確認。</p>
          <a href={`?example=${draft.template}`} target="_blank" rel="noreferrer">查看填寫範例<ExternalLink size={13} /></a>
          <p>適用依據：115 年版報支檢查表；日支額自 2026 年 1 月 1 日生效。</p>
          <p>匯率資料：{fxInfo?.earliestQuotationDate ?? '—'} 至 {fxInfo?.latestQuotationDate ?? '—'}。未收錄所需日期時，請匯入臺銀匯率檔或依證明填寫。</p>
          <a href="https://acc.nccu.edu.tw/content/%E6%97%85%E9%81%8B%E8%B2%BB" target="_blank" rel="noreferrer">政大旅運費規則<ExternalLink size={13} /></a>
        </div></details>
      </footer>
      <ConfirmChange open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'restore' ? '恢復上一份草稿？' : '重新填寫報帳表？'} description={confirm === 'restore' ? '目前內容會由上一份草稿取代。目前這份仍會保留，可再次恢復。' : '姓名、行程與費用將清空。系統會先保留目前草稿，之後可從「更多操作」恢復。'} confirmLabel={confirm === 'restore' ? '恢復草稿' : '重新填寫'} onConfirm={async () => {
        const success = confirm === 'restore' ? await restoreDraft() : await replaceDraft(createEmptyDraft());
        if (!success) { setMessage('未更動目前內容。請確認草稿提示後重試。'); return; }
        setTab('person'); setFocus(''); setShowErrors(false); setVisited([]); setTouched([]); scrollPositions.current = {};
        setMessage(confirm === 'restore' ? '已恢復上一份草稿。' : '已建立空白報帳表，上一份草稿可從「更多操作」恢復。');
        window.scrollTo({ top: 0, behavior: 'instant' });
      }} />
    </div>
  );
}
