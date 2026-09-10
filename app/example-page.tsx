import { useMemo, useState } from 'react';
import { BookOpen, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { calculateClaim, CATEGORY_LABELS } from '@/lib/claim/claim-engine';
import { createPublicExample } from '@/lib/public-example';
import type { Template } from '@/lib/claim/types';
import { ReportPreview } from './report-preview';
import { useReport } from './use-report';
const money = (value: number | string | null) => value === null ? '—' : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 5 });

export default function ExamplePage({ initialTemplate }: { initialTemplate: Template }) {
  const [template, setTemplate] = useState(initialTemplate);
  const [tab, setTab] = useState('person');
  const [retry, setRetry] = useState(0);
  const draft = useMemo(() => createPublicExample(template), [template]);
  const calculation = useMemo(() => calculateClaim(draft), [draft]);
  const { mapped, error } = useReport(draft, calculation, retry);
  return <div className="workbench product-workbench example-workbench">
    <header className="app-header"><div className="brand"><span className="brand-icon"><FileSpreadsheet size={23} /></span><span>差旅報帳<span className="brand-sub">政大國外出差 · 115 年版</span></span></div><span className="example-label"><BookOpen size={16} />填寫範例</span></header>
    <div className="example-intro"><div><h1>填寫範例</h1><p>此頁僅供查看，不會更動您的草稿。姓名與金額為虛構資料；實際報帳請依核定內容與費用憑證填寫。</p></div><div className="button-row">{(['general', 'student'] as const).map((kind) => <Button key={kind} variant="outline" aria-pressed={template === kind} onClick={() => { setTemplate(kind); history.replaceState(null, '', `?example=${kind}`); }}>{kind === 'general' ? '一般版' : '學生版'}</Button>)}</div></div>
    {error && <div className="page-notice error" role="alert">{error}<Button variant="outline" onClick={() => setRetry(retry + 1)}>重試</Button></div>}
    <main className="workspace">
      <section className="editor example-editor" aria-label="填寫範例內容"><Tabs value={tab} onValueChange={(value) => setTab(String(value))}><TabsList className="section-tabs"><TabsTrigger value="person">基本資料</TabsTrigger><TabsTrigger value="trip">行程與生活費</TabsTrigger><TabsTrigger value="cost">費用</TabsTrigger><TabsTrigger value="calculation">計算說明</TabsTrigger></TabsList>
        <TabsContent value="person"><h2 className="form-title">基本資料</h2><dl className="read-only-fields"><dt>姓名</dt><dd>{draft.person.name}</dd><dt>{template === 'student' ? '學生證號' : '員工代碼'}</dt><dd>{draft.person.identifier}</dd><dt>職稱</dt><dd>{draft.person.title}</dd><dt>出差事由</dt><dd>{draft.purpose}</dd><dt>預算科目</dt><dd>{draft.budgetItem}</dd><dt>補助上限</dt><dd>{draft.fundingLimit ? `NT$ ${money(draft.fundingLimit)}` : '無'}</dd></dl></TabsContent>
        <TabsContent value="trip"><h2 className="form-title">行程與生活費</h2><p className="example-rate">生活費美元匯率：31.5（2026-08-31）</p>{draft.days.map((day, index) => <article className="example-entry" key={day.id}><h3>{day.date} · {day.kind === 'personal' ? '個人行程' : day.work}</h3><p>{day.location || '地點未填'}</p>{day.kind !== 'personal' ? <><p>日支額 US$ {day.usdRate} · 請領比例 {calculation.daily[index].percent}%</p><p>{calculation.daily[index].formula} = US$ {money(calculation.daily[index].netUsd)}</p><small>{calculation.daily[index].reason}</small></> : <p>不請領生活費；地點可選填。</p>}</article>)}</TabsContent>
        <TabsContent value="cost"><h2 className="form-title">費用</h2>{draft.expenses.map((expense, index) => <article className="example-entry" key={expense.id}><h3>{CATEGORY_LABELS[expense.category]} · {expense.description}</h3><p>{expense.date} · {expense.currency} {money(expense.amount)}</p>{expense.currency !== 'TWD' && <p>本筆匯率 {expense.fxRate}（{expense.fxDate}）</p>}<p>折合 NT$ {money(calculation.expenses[index].exactTwd)}</p></article>)}<p className="field-hint">各筆費用可使用不同匯率；沒有自編單據號數時可留白。</p></TabsContent>
        <TabsContent value="calculation"><h2 className="form-title">計算說明</h2><dl className="read-only-fields">{calculation.categories.map((category) => <div className="read-only-pair" key={category.category}><dt>{category.label}</dt><dd>NT$ {money(category.twd)}</dd></div>)}<dt>計算旅費</dt><dd>NT$ {money(calculation.totalTwd)}</dd><dt>本次申請金額</dt><dd>NT$ {money(calculation.claimTwd)}</dd>{calculation.totalTwd !== null && calculation.claimTwd !== null && calculation.totalTwd !== calculation.claimTwd && <><dt>不向本案報支</dt><dd>NT$ {money(calculation.totalTwd - calculation.claimTwd)}</dd></>}</dl><p className="field-hint">生活費按每日條件計算，各項費用使用各自的匯率。各費目換算臺幣後加總，申請額另受核定補助上限限制。</p></TabsContent>
      </Tabs></section>
      <ReportPreview manifest={mapped.manifest} changes={mapped.changes} draft={draft} focused="" errors={mapped.errors} />
    </main>
  </div>;
}
