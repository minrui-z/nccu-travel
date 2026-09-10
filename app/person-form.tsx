import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Area, Choice, CheckField } from './fields';
import type { WorkbenchDraft } from './model';
export function PersonForm({
  draft,
  setDraft,
  focus,
}: {
  draft: WorkbenchDraft;
  setDraft: (d: WorkbenchDraft) => void;
  focus: (s: string) => void;
}) {
  const funding = draft.funding!;
  const set = (key: keyof WorkbenchDraft, value: unknown) =>
    setDraft({ ...draft, [key]: value });
  const person = (key: keyof WorkbenchDraft['person'], value: string) =>
    set('person', { ...draft.person, [key]: value });
  const fund = (value: Partial<typeof funding>) =>
    set('funding', { ...funding, ...value });
  return (
    <>
<h2 className="form-title">基本資料</h2>
      <div className="template-choice">
        {(
          [
            ['general', '一般版', '教職員／其他人員'],
            ['student', '學生版', '在學學生'],
          ] as const
        ).map(([value, label, hint]) => (
          <Button
            key={value}
            variant="outline"
            className={draft.template === value ? 'active-choice' : ''}
            aria-pressed={draft.template === value}
            onClick={() => set('template', value)}
          >
            {draft.template === value && <Check size={16} />} {label}
            <span>{hint}</span>
          </Button>
        ))}
      </div>
      <div className="fields">
        <Field
          label="姓名"
          path="person.name"
          value={draft.person.name}
          onChange={(v) => person('name', v)}
          placeholder="填寫出差人姓名"
          onFocus={() => focus('person')}
        />
        <Field
          label={draft.template === 'student' ? '學生證號' : '員工代碼'}
          path="person.identifier"
          value={draft.person.identifier}
          onChange={(v) => person('identifier', v)}
          onFocus={() => focus('person')}
        />
        <Field
          label="職稱"
          path="person.title"
          value={draft.person.title}
          onChange={(v) => person('title', v)}
          placeholder={
            draft.template === 'student' ? '例如：研究生' : '例如：助理教授'
          }
          onFocus={() => focus('person')}
        />
        {draft.template === 'general' ? (
          <Field
            label="職等"
            path="person.grade"
          value={draft.person.grade}
            onChange={(v) => person('grade', v)}
            placeholder="無則留白"
            onFocus={() => focus('person')}
          />
        ) : (
          <div />
        )}
        <Area
          label="出差事由"
          path="purpose"
          value={draft.purpose}
          onChange={(v) => set('purpose', v)}
          placeholder="會議名稱、參訪或執行工作"
          onFocus={() => focus('purpose')}
        />
        <Field
          label="憑證編號"
          path="voucherNumber"
          value={draft.voucherNumber}
          onChange={(v) => set('voucherNumber', v)}
          placeholder="尚未編號可留白"
          onFocus={() => focus('budget')}
        />
        <Field
          label="預算科目"
          path="budgetItem"
          value={draft.budgetItem}
          onChange={(v) => set('budgetItem', v)}
          onFocus={() => focus('budget')}
        />
        <Field
          label={
            draft.template === 'student'
              ? '本案核定補助上限（NT$）'
              : '本次申請金額上限（NT$）'
          }
          path="fundingLimit"
          value={draft.fundingLimit}
          onChange={(v) => set('fundingLimit', v)}
          placeholder="無上限則留白"
          hint={
            draft.template === 'student'
              ? '依核定函填寫。總計保留計算額與申請額，超額不向本案報支。'
              : '上限不改變旅費計算額；總計另外註明本次申請額。'
          }
          full
          onFocus={() => focus('total')}
        />
      </div>
      <div className="form-divider" />
      <h3 className="subheading">經費資料</h3>
      <div className="fields">
        <Choice
          label="經費來源"
          path="funding.type"
          value={funding.type}
          options={[
            ['other', '其他經費'],
            ['nstc', '國科會計畫'],
          ]}
          onChange={(v) => fund({ type: v as typeof funding.type })}
          full
        />
        {funding.type === 'nstc' && (
          <Choice
            label="參與國際會議的身分"
            path="funding.activityRole"
          value={funding.activityRole}
            options={[
              ['paper', '發表研究成果論文'],
              ['speaker', '專題演講'],
              ['chair', '會議主持人'],
              ['approved', '已取得個案同意'],
              ['other', '其他'],
            ]}
            onChange={(v) =>
              fund({ activityRole: v as typeof funding.activityRole })
            }
            full
          />
        )}
      </div>
      <div className="checks">
        {funding.type === 'nstc' && funding.activityRole === 'approved' && <CheckField
          label="已取得參與本次會議的個案同意"
          path="funding.priorApproval"
          checked={funding.priorApproval}
          onChange={(v) => fund({ priorApproval: v })}
        />}
        {funding.type === 'other' && (
          <CheckField
            label="委託或補助單位已核定出國項目明細"
            path="funding.approvedItems"
          checked={funding.approvedItems}
            onChange={(v) => fund({ approvedItems: v })}
            hint="未列於核定明細的行政費仍須事前核准。"
          />
        )}
        <CheckField
          label="有其他經費來源分攤"
          path="funding.shared"
          checked={funding.shared}
          onChange={(v) => fund({ shared: v })}
        />
        {funding.shared && (
          <CheckField
            label="經費分攤已完成校內簽准"
            path="funding.sharingApproved"
          checked={funding.sharingApproved}
            onChange={(v) => fund({ sharingApproved: v })}
          />
        )}
        <CheckField
          label="行程或出國種類與原核定不同"
          path="funding.planChanged"
          checked={funding.planChanged}
          onChange={(v) => fund({ planChanged: v })}
        />
        {funding.planChanged && (
          <CheckField
            label="已完成計畫變更核准"
            path="funding.changeApproved"
          checked={funding.changeApproved}
            onChange={(v) => fund({ changeApproved: v })}
          />
        )}
      </div>
      <details className="inline-help"><summary>經費分攤與生活費</summary><p>分攤經費與免費供膳宿分別記錄。生活費依每日實際膳宿條件計算。</p></details>

    </>
  );
}
