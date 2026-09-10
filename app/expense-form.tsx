import { ExpenseCsv } from './expense-csv';
import { updateExpense, expenseFxContext } from '@/lib/expense-state';
import { isAutomaticExpenseFx } from '@/lib/expense-auto-fx';
import {
  expenseIssues,
  expenseFxComplete,
  requestedExpenseId,
  formatExpenseAmount,
} from '@/lib/expense-view';
import { FxInputError } from '@/lib/fx-errors';
import './expense-form.css';
import type { ExpenseFxAutoFill } from './use-expense-fx-auto-fill';
import { CURRENCY_OPTIONS as currencies } from '@/lib/currencies';
import {
  useState,
  useRef,
  useMemo,
  useLayoutEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  CreditCard,
  ExternalLink,
  Plus,
  ReceiptText,
  ShieldCheck,
  Trash2,
  Undo2,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CATEGORY_LABELS,
  civilDay,
  fxReferenceDate,
  fxDepartureDate,
  calculateClaim,
} from '@/lib/claim/claim-engine';
import type { Category, Expense, FxSource } from '@/lib/claim/types';
import type { InsuranceData } from '@/lib/public-data';
import { Area, CheckField, Choice, Field } from './fields';
import type { WorkbenchDraft } from './model';

export interface ExpenseFormProps {
  draft: WorkbenchDraft;
  setDraft: Dispatch<SetStateAction<WorkbenchDraft>>;
  insurance: InsuranceData | null;
  focus: (key: string) => void;
  fxAutoFill: ExpenseFxAutoFill;
  requestedPath?: string;
}
const categories = Object.entries(CATEGORY_LABELS).filter(
  ([value]) => value !== 'living',
) as Array<[Category, string]>;
const fxSources: Array<[FxSource, string]> = [
  ['bot-cash', '臺灣銀行・現金賣出'],
  ['bot-spot', '臺灣銀行・即期賣出'],
  ['receipt', '結匯水單／匯率憑證'],
  ['central-bank', '當地央行兌美元交叉匯率'],
  ['manual', '手動填寫並附來源'],
];

export function ExpenseForm({
  draft,
  setDraft,
  insurance,
  focus,
  fxAutoFill,
  requestedPath,
}: ExpenseFormProps) {
  const latest = useRef(draft);
  latest.current = draft;
  const calculation = useMemo(() => calculateClaim(draft), [draft]);
  const [activeId, setActiveId] = useState<string | null>(
    draft.expenses[0]?.id ?? null,
  );
  const [adding, setAdding] = useState(false);
  const [editingFx, setEditingFx] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const categoryPicker = useRef<HTMLElement>(null);
  const newExpense = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!adding) return;
    const button = categoryPicker.current?.querySelector<HTMLElement>(
      '.expense-category-options button',
    );
    button?.focus();
    button?.scrollIntoView({ block: 'nearest' });
  }, [adding]);
  const closeExpense = (id: string) => {
    setActiveId(null);
    requestAnimationFrame(() => rowButtons.current.get(id)?.focus());
  };
  useLayoutEffect(() => {
    if (newExpense.current !== activeId || !activeId) return;
    const editor = document.getElementById(`expense-editor-${activeId}`);
    const control = editor?.querySelector<HTMLElement>('input, button');
    control?.focus();
    control?.scrollIntoView({ block: 'nearest' });
    newExpense.current = null;
  }, [activeId, draft.expenses.length]);
  useLayoutEffect(() => {
    const id = requestedExpenseId(draft, requestedPath);
    if (id) {
      setActiveId(id);
      if (
        /\.(?:fx|manualBasis|cashUnavailable|botUnavailable)/.test(
          requestedPath ?? '',
        )
      )
        setEditingFx(id);
    }
  }, [requestedPath, draft]);
  const [removed, setRemoved] = useState<{
    expense: Expense;
    index: number;
  } | null>(null);
  const patch = (id: string, update: Partial<Expense>) =>
    setDraft((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === id ? updateExpense(expense, update) : expense,
      ),
    }));
  const add = (category: Category) => {
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `expense-${Date.now()}-${draft.expenses.length}`;
    setDraft({
      ...draft,
      expenses: [
        ...draft.expenses,
        {
          id,
          date:
            draft.days.find((day) => day.kind !== 'personal')?.date ||
            draft.startDate ||
            '',
          category,
          description: '',
          amount: '',
          currency: 'TWD',
          fxRate: '',
          payment: 'cash',
          cardTwd: '',
          cardFeeTwd: '',
          receipt: '',
          foreignTaxi: false,
          fxDate: '',
          fxSource: 'bot-cash',
          fxProofNote: '',
        },
      ],
    });
    newExpense.current = id;
    setActiveId(id);
    setAdding(false);
    focus('expenses');
  };
  const remove = (expense: Expense, index: number) => {
    setRemoved({ expense, index });
    setDraft({
      ...draft,
      expenses: draft.expenses.filter((item) => item.id !== expense.id),
    });
    const next = draft.expenses[index + 1] ?? draft.expenses[index - 1];
    if (activeId === expense.id) setActiveId(next?.id ?? null);
    if (next)
      requestAnimationFrame(() => rowButtons.current.get(next.id)?.focus());
    else setAdding(true);
  };
  const restore = () => {
    if (!removed) return;
    const expenses = [...draft.expenses];
    if (!expenses.some((item) => item.id === removed.expense.id))
      expenses.splice(
        Math.min(removed.index, expenses.length),
        0,
        removed.expense,
      );
    setDraft({ ...draft, expenses });
    setActiveId(removed.expense.id);
    setRemoved(null);
  };
  const selection = draft.insuranceSelection ?? {
    contractId: '',
    planId: '',
    days: '',
  };
  const contract = insurance?.contracts.find(
    (item) => item.id === selection.contractId,
  );
  const plan = contract?.plans.find((item) => item.id === selection.planId);
  const source = insurance?.sources.find(
    (item) => item.id === contract?.sourceId,
  );
  const quotedPremium = plan?.premiumsNtdByDays[selection.days];
  const contractApplies =
    !!contract &&
    !!draft.startDate &&
    draft.startDate >= contract.effectiveFrom &&
    draft.startDate <= contract.effectiveTo;
  const setSelection = (update: Partial<typeof selection>) =>
    setDraft({
      ...draft,
      insuranceSelection: { ...selection, ...update },
      insurance: { ...draft.insurance, capConfirmed: false },
    });
  const travelDays = (() => {
    const from = civilDay(draft.startDate);
    const to = civilDay(draft.endDate);
    return from !== null && to !== null && to >= from
      ? String(to - from + 1)
      : '';
  })();
  const fxDate = fxReferenceDate(fxDepartureDate(draft));
  const funding = draft.funding;

  const insuranceFields = (
    <>
      <div className="form-divider" />
      <div className="inline-heading">
        <h3 className="subheading">
          <ShieldCheck size={18} />
          保險額度與保費上限
        </h3>
        {source && (
          <a href={source.url} target="_blank" rel="noreferrer">
            官方費率表
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      <p className="field-hint">
        綜合保險額度上限為 400
        萬元；可報保費另依適用共同供應契約、方案及日數查核。
      </p>
      {insurance ? (
        <div
          className="insurance-lookup"
          data-field-path="insurance"
          tabIndex={-1}
        >
          <div className="fields">
            <Choice
              path="insuranceSelection.contractId"
              label="共同供應契約期間"
              value={selection.contractId || 'none'}
              options={[
                ['none', '請選擇適用契約'],
                ...insurance.contracts.map(
                  (item) =>
                    [
                      item.id,
                      `${item.effectiveFrom} 至 ${item.effectiveTo}`,
                    ] as [string, string],
                ),
              ]}
              onChange={(value) =>
                setSelection({
                  contractId: value === 'none' ? '' : value,
                  planId: '',
                })
              }
              full
            />
            {contract && (
              <Choice
                path="insuranceSelection.planId"
                label="保險方案"
                value={selection.planId || 'none'}
                options={[
                  ['none', '請選擇保險方案'],
                  ...contract.plans.map(
                    (item) => [item.id, item.officialLabel] as [string, string],
                  ),
                ]}
                onChange={(value) =>
                  setSelection({ planId: value === 'none' ? '' : value })
                }
                full
              />
            )}
            <Field
              path="insuranceSelection.days"
              label="保險日數"
              value={selection.days}
              onChange={(value) => setSelection({ days: value })}
              placeholder={travelDays || '依保單填寫'}
              hint="依實際保單日數核對，勿將延長私人行程自動納入。"
            />
            {travelDays && (
              <div className="field insurance-days-action">
                <Button
                  variant="outline"
                  onClick={() => setSelection({ days: travelDays })}
                >
                  帶入行程 {travelDays} 日
                </Button>
              </div>
            )}
          </div>
          {contract && !contractApplies && (
            <p className="field-error">
              奉派出差日期不在此契約期間，請核對投保日期及實際適用契約；網站不會自動套用上限。
            </p>
          )}
          {plan && selection.days && (
            <div className="insurance-quote">
              <span>官方表列保費</span>
              <strong>
                {quotedPremium ? `NT$ ${quotedPremium}` : '此日數無表列資料'}
              </strong>
              {quotedPremium && (
                <Button
                  variant="outline"
                  disabled={!contractApplies}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      insurance: {
                        ...draft.insurance,
                        premiumCap: quotedPremium,
                        capConfirmed: false,
                      },
                    })
                  }
                >
                  填入保費上限
                </Button>
              )}
              <p className="field-hint">
                {plan.officialLabel}，來源第 {plan.sourcePage}{' '}
                頁。帶入後仍須確認本人年齡、保額與保障內容。
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="field-hint">
          官方保費資料尚未載入，可先填單據；請依適用契約查核後再填寫上限。
          <a
            href="https://acc.nccu.edu.tw/content/%E6%97%85%E9%81%8B%E8%B2%BB"
            target="_blank"
            rel="noreferrer"
          >
            政大旅運費資料
          </a>
        </p>
      )}
      <div className="fields">
        <Field
          path="insurance.coverageAmount"
          label="綜合保險額度（NT$）"
          value={draft.insurance.coverageAmount}
          onChange={(value) =>
            setDraft({
              ...draft,
              insurance: {
                ...draft.insurance,
                coverageAmount: value,
                capConfirmed: false,
              },
            })
          }
          placeholder="依保單填寫，上限 4,000,000"
        />
        <Field
          path="insurance.premiumCap"
          label="適用契約保費上限（NT$）"
          value={draft.insurance.premiumCap}
          onChange={(value) =>
            setDraft({
              ...draft,
              insurance: {
                ...draft.insurance,
                premiumCap: value,
                capConfirmed: false,
              },
            })
          }
          placeholder="依官方表查核後填寫"
        />
      </div>
      <CheckField
        path="insurance.capConfirmed"
        label="已核對本人適用方案、保障額度、保險日數及保費上限"
        checked={draft.insurance.capConfirmed}
        onChange={(value) =>
          setDraft({
            ...draft,
            insurance: { ...draft.insurance, capConfirmed: value },
          })
        }
        hint="保額與保費分別檢查；請依適用方案填寫。"
      />
    </>
  );
  const cabinFields = (
    <>
      <div className="form-divider" />
      <h3 className="subheading" data-field-path="cabin" tabIndex={-1}>
        機票艙等與附件
      </h3>
      <div className="checks">
        <CheckField
          path="cabin.standard"
          label="實際搭乘基礎等級（標準）座艙"
          checked={draft.cabin.standard}
          onChange={(value) =>
            setDraft({
              ...draft,
              cabin: { ...draft.cabin, standard: value },
            })
          }
          hint="指經濟艙，不包含豪華經濟艙。"
        />
        <CheckField
          path="foreignAirline"
          label="搭乘外國籍航空公司班機"
          checked={!!draft.foreignAirline}
          onChange={(value) => setDraft({ ...draft, foreignAirline: value })}
          hint="檢附經申請人簽章的外國籍航空公司班機申請書。"
        />
        {!draft.cabin.standard && (
          <>
            {draft.template === 'general' && (
              <CheckField
                path="cabin.seniorEligible"
                label="符合簡任十二職等以上，並領有全額主管加給"
                checked={draft.cabin.seniorEligible}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    cabin: { ...draft.cabin, seniorEligible: value },
                  })
                }
                hint="符合例外且非經濟艙者，需另填原表附表及檢附證明。"
              />
            )}
            <CheckField
              path="economyClaimOnly"
              label="個人升等或繞道，已將申請額限制於可報經濟艙票價"
              checked={!!draft.economyClaimOnly}
              onChange={(value) =>
                setDraft({ ...draft, economyClaimOnly: value })
              }
              hint="需附航空公司或旅行社出具的最直接航程經濟艙票價證明。"
            />
            <Area
              path="airfareExplanation"
              label="機票升等或繞道說明"
              value={draft.airfareExplanation || ''}
              onChange={(value) =>
                setDraft({ ...draft, airfareExplanation: value })
              }
              placeholder="說明實際艙等、可報票價與證明文件"
            />
          </>
        )}
      </div>
    </>
  );
  const approvalFields = (
    <>
      {funding &&
        (funding.type === 'other' ||
          draft.expenses.some(
            (e) =>
              e.category === 'registration' && e.administrativeType === 'other',
          )) && (
          <>
            <div className="form-divider" />
            <CheckField
              path="funding.priorApproval"
              label="行政費已取得出國前所需核准"
              checked={funding.priorApproval}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  funding: { ...funding, priorApproval: value },
                })
              }
              hint="核對預計支用的註冊費／報名費是否列於核准內容，並保留簽文。"
            />
          </>
        )}
    </>
  );

  return (
    <>
      <div className="section-heading">
        <span className="section-symbol">
          <ReceiptText />
        </span>
        <div>
          <h2>費用與憑證</h2>
          <p>填寫機票、報名費等支出；生活費依行程另外計算。</p>
        </div>
      </div>
      {(adding || draft.expenses.length === 0) && (
        <section
          ref={categoryPicker}
          className="expense-category-picker"
          aria-label="新增費用"
        >
          <div className="inline-heading">
            <h3>{draft.expenses.length ? '新增費用' : '選擇費用類別'}</h3>
            {draft.expenses.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAdding(false)}
              >
                取消
              </Button>
            )}
          </div>
          <div className="expense-category-options">
            {categories.map(([category, label]) => (
              <Button
                key={category}
                variant="outline"
                onClick={() => add(category)}
              >
                {label}
              </Button>
            ))}
          </div>
        </section>
      )}
      <div className="expense-list">
        {draft.expenses.map((expense, index) => {
          const automaticFx = isAutomaticExpenseFx(expense);
          const fxStatus = fxAutoFill.statuses[expense.id];
          const foreign = !['TWD', 'NTD'].includes(
            expense.currency.trim().toUpperCase(),
          );
          const currencyChoice = currencies.some(
            ([value]) => value === expense.currency,
          )
            ? expense.currency
            : 'OTHER';
          const expanded = activeId === expense.id;
          const problems = expenseIssues(expense, index, calculation.issues);
          const converted = calculation.expenses.find(
            (item) => item.id === expense.id,
          )?.exactTwd;
          const headerAmount =
            converted === null || converted === undefined
              ? '金額待填'
              : `NT$ ${formatExpenseAmount(converted)}`;
          const fxReady = expenseFxComplete(expense, index, calculation);
          const showFxEditor = !fxReady || editingFx === expense.id;
          return (
            <article
              key={expense.id}
              className={`expense-card expense-entry ${expanded ? 'is-expanded' : ''}`}
              data-field-path={`expenses.${index}`}
              tabIndex={-1}
              aria-labelledby={`expense-${expense.id}`}
              onFocusCapture={() => focus('expenses')}
            >
              <div className="expense-card-heading">
                <h3 id={`expense-${expense.id}`}>
                  <button
                    ref={(element) => {
                      if (element) rowButtons.current.set(expense.id, element);
                      else rowButtons.current.delete(expense.id);
                    }}
                    className="expense-row-toggle"
                    aria-expanded={expanded}
                    aria-controls={`expense-editor-${expense.id}`}
                    onClick={() =>
                      expanded
                        ? closeExpense(expense.id)
                        : setActiveId(expense.id)
                    }
                  >
                    <span className="expense-row-copy">
                      <span className="expense-row-title">
                        費用 {index + 1} · {CATEGORY_LABELS[expense.category]}
                      </span>
                      <span className="expense-row-description">
                        {expense.description}
                      </span>
                      <span className="expense-row-meta">
                        {expense.date || '日期待填'} ·{' '}
                        {expense.currency || '幣別待填'}
                        {expense.amount
                          ? ` ${formatExpenseAmount(expense.amount)}`
                          : ''}
                        {expense.payment === 'card' ? ' · 信用卡' : ''}
                      </span>
                    </span>
                    <span className="expense-row-value">
                      <strong>{headerAmount}</strong>
                      <span
                        className={`expense-completion ${problems.length ? 'incomplete' : 'complete'}`}
                      >
                        {problems.length ? (
                          '待補資料'
                        ) : (
                          <>
                            <Check size={14} />
                            已填寫
                          </>
                        )}
                      </span>
                    </span>
                    <ChevronDown size={17} className="expense-expand-icon" />
                  </button>
                </h3>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(expense, index)}
                  aria-label={`刪除第 ${index + 1} 筆${CATEGORY_LABELS[expense.category]}`}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              {expanded && (
                <div
                  id={`expense-editor-${expense.id}`}
                  className="expense-editor"
                >
                  <div className="fields">
                    <Choice
                      path={`expenses.${index}.category`}
                      label="費用類別"
                      value={expense.category}
                      options={categories}
                      onChange={(value) =>
                        patch(expense.id, { category: value as Category })
                      }
                    />
                    {expense.category === 'registration' && (
                      <Choice
                        path={`expenses.${index}.administrativeType`}
                        label="行政費項目"
                        value={expense.administrativeType ?? 'registration'}
                        options={[
                          ['registration', '註冊費／報名費'],
                          ['other', '郵電、翻譯等其他行政費'],
                        ]}
                        onChange={(v) =>
                          patch(expense.id, {
                            administrativeType: v as 'registration' | 'other',
                          })
                        }
                        hint="國科會計畫的免事前簽准例外僅限報名／註冊費。"
                      />
                    )}
                    <Field
                      path={`expenses.${index}.date`}
                      label="列入日期"
                      type="date"
                      value={expense.date}
                      min={draft.startDate}
                      max={draft.endDate}
                      onChange={(value) => patch(expense.id, { date: value })}
                      hint="選擇報表中的行程日期。預付機票或報名費可列首日。"
                    />
                    <Field
                      path={`expenses.${index}.description`}
                      label="費用說明"
                      value={expense.description}
                      onChange={(value) =>
                        patch(expense.id, { description: value })
                      }
                      placeholder="例如：會議註冊費、往返機票"
                      full
                    />
                    <Field
                      path={`expenses.${index}.receipt`}
                      label="單據號數（選填）"
                      value={expense.receipt}
                      onChange={(value) =>
                        patch(expense.id, { receipt: value })
                      }
                      placeholder="例如：1 或 1、2"
                      hint="可填附件自編號；尚未編號可留白。"
                    />
                    <Choice
                      path={`expenses.${index}.payment`}
                      label="付款方式"
                      value={expense.payment}
                      options={[
                        ['cash', '原幣金額／臺幣付款'],
                        ['card', '信用卡臺幣結算'],
                      ]}
                      onChange={(value) =>
                        patch(expense.id, {
                          payment: value as Expense['payment'],
                        })
                      }
                    />
                    <Choice
                      path={`expenses.${index}.currency`}
                      label="單據幣別"
                      value={currencyChoice}
                      options={currencies}
                      onChange={(value) =>
                        patch(expense.id, {
                          currency: value === 'OTHER' ? '' : value,
                        })
                      }
                    />
                    {currencyChoice === 'OTHER' && (
                      <Field
                        path={`expenses.${index}.currency`}
                        label="其他幣別代碼"
                        value={expense.currency}
                        onChange={(value) =>
                          patch(expense.id, { currency: value.toUpperCase() })
                        }
                        placeholder="例如：THB"
                      />
                    )}
                    <Field
                      path={`expenses.${index}.amount`}
                      label={
                        expense.payment === 'card'
                          ? '原幣金額（供核對）'
                          : '原幣金額'
                      }
                      value={expense.amount}
                      onChange={(value) => patch(expense.id, { amount: value })}
                      placeholder="依單據填寫"
                      hint={
                        expense.payment === 'card'
                          ? '計算使用下方信用卡實際結算臺幣。'
                          : '請依單據填寫金額。'
                      }
                    />
                  </div>
                  {expense.payment === 'card' ? (
                    <div className="expense-detail-block">
                      <h4>
                        <CreditCard size={16} />
                        信用卡帳單結算
                      </h4>
                      <div className="fields">
                        <Field
                          path={`expenses.${index}.cardTwd`}
                          label="實際結算金額（NT$）"
                          value={expense.cardTwd}
                          onChange={(value) =>
                            patch(expense.id, { cardTwd: value })
                          }
                          hint="直接填信用卡帳單臺幣金額，不再乘匯率。"
                        />
                        <Field
                          path={`expenses.${index}.cardFeeTwd`}
                          label="國外交易手續費（NT$）"
                          value={expense.cardFeeTwd}
                          onChange={(value) =>
                            patch(expense.id, { cardFeeTwd: value })
                          }
                          placeholder="無則留白"
                          hint="獨立列示；避免同時列入其他費用。"
                        />
                      </div>
                      <p className="field-hint">
                        檢附信用卡帳單；申請國外交易手續費另附支出證明單。
                      </p>
                    </div>
                  ) : foreign ? (
                    <div className="expense-detail-block">
                      {!showFxEditor ? (
                        <div className="expense-fx-summary">
                          <div>
                            <h4>匯率</h4>
                            <strong>
                              1 {expense.currency} = NT$ {expense.fxRate}
                            </strong>
                            <p>
                              {expense.fxDate} ·{' '}
                              {expense.fxProvenance === 'imported'
                                ? `臺銀匯率檔 · ${expense.cashUnavailable ? '即期' : '現金'}賣出`
                                : fxSources.find(
                                    ([value]) => value === expense.fxSource,
                                  )?.[1] || '自行填寫'}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingFx(expense.id)}
                          >
                            修改匯率
                          </Button>
                        </div>
                      ) : (
                        <div
                          className="expense-fx-editor"
                          onFocusCapture={() => setEditingFx(expense.id)}
                        >
                          <div className="inline-heading">
                            <h4>匯率</h4>
                            <a
                              href="https://rate.bot.com.tw/xrt?Lang=zh-TW"
                              target="_blank"
                              rel="noreferrer"
                            >
                              查臺銀匯率
                              <ExternalLink size={13} />
                            </a>
                          </div>
                          <div className="fields">
                            <Choice
                              path={`expenses.${index}.fxSource`}
                              label="匯率來源"
                              value={expense.fxSource || 'manual'}
                              options={fxSources}
                              onChange={(value) =>
                                patch(expense.id, {
                                  fxSource: value as FxSource,
                                })
                              }
                              hint="臺銀報價依出差日期帶入；使用結匯證明時請自行填寫。"
                              full
                            />
                            <Field
                              path={`expenses.${index}.fxRate`}
                              label={`每 1 ${expense.currency} 折合臺幣`}
                              value={expense.fxRate}
                              onChange={(value) =>
                                patch(expense.id, {
                                  fxRate: value,
                                  fxProvenance: 'manual',
                                  ...(automaticFx
                                    ? {
                                        fxSource: 'manual',
                                        manualBasis: 'bank',
                                      }
                                    : {}),
                                })
                              }
                              placeholder="請依官方報價或憑證填寫"
                              hint={
                                automaticFx
                                  ? '如需自行輸入，請保留匯率證明。'
                                  : undefined
                              }
                            />
                            <Field
                              path={`expenses.${index}.fxDate`}
                              label="匯率資料日期"
                              value={expense.fxDate || ''}
                              type="date"
                              readOnly={automaticFx}
                              onChange={(value) =>
                                patch(expense.id, { fxDate: value })
                              }
                              hint={
                                automaticFx
                                  ? '依匯率基準出發日計算，週六、日往前至週五。其他休假日請附依據並改用手動填寫。'
                                  : undefined
                              }
                            />
                            {expense.fxSource === 'bot-spot' && (
                              <div className="full">
                                <CheckField
                                  path={`expenses.${index}.cashUnavailable`}
                                  label="已核對臺銀未提供此幣別的現金賣出報價"
                                  checked={!!expense.cashUnavailable}
                                  onChange={(v) =>
                                    patch(expense.id, { cashUnavailable: v })
                                  }
                                />
                              </div>
                            )}
                            {expense.fxSource === 'central-bank' && (
                              <div className="full">
                                <CheckField
                                  path={`expenses.${index}.botUnavailable`}
                                  label="已核對臺銀未提供此幣別賣出報價"
                                  checked={!!expense.botUnavailable}
                                  onChange={(v) =>
                                    patch(expense.id, { botUnavailable: v })
                                  }
                                />
                              </div>
                            )}
                            {expense.fxSource === 'manual' && (
                              <Choice
                                path={`expenses.${index}.manualBasis`}
                                label="匯率證明種類"
                                value={expense.manualBasis ?? 'bank'}
                                options={[
                                  ['bank', '指定日期的銀行報價'],
                                  ['receipt', '有效期間內的結匯證明'],
                                ]}
                                onChange={(v) =>
                                  patch(expense.id, {
                                    manualBasis: v as 'bank' | 'receipt',
                                  })
                                }
                                full
                              />
                            )}
                            <Area
                              path={`expenses.${index}.fxProofNote`}
                              label="匯率證明來源與說明"
                              value={expense.fxProofNote || ''}
                              onChange={(value) =>
                                patch(expense.id, { fxProofNote: value })
                              }
                              placeholder="來源網址、結匯水單或交叉匯率算式"
                              hint={
                                expense.fxSource === 'receipt'
                                  ? '水單日期須在奉派出差日前 15 日至返國日之間。'
                                  : '無現金賣出報價才改用即期；臺銀未列報價時，再依官方央行資料換算。'
                              }
                            />
                          </div>
                          {expense.currency === 'USD' &&
                            draft.fx.rate &&
                            draft.fx.source !== 'card' && (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  patch(expense.id, {
                                    fxRate: draft.fx.rate,
                                    fxDate: draft.fx.rateDate,
                                    fxSource:
                                      draft.fx.source === 'bot'
                                        ? 'bot-cash'
                                        : draft.fx.source,
                                    fxProofNote: draft.fx.proofNote,
                                    fxProvenance: 'manual',
                                    manualBasis: draft.fx.manualBasis,
                                  })
                                }
                              >
                                套用生活費美元匯率 {draft.fx.rate}
                              </Button>
                            )}
                          {automaticFx && (
                            <>
                              {fxStatus && (
                                <p
                                  className={
                                    fxStatus.state === 'error'
                                      ? 'field-error'
                                      : 'field-hint'
                                  }
                                  role="status"
                                >
                                  {fxStatus.message}
                                </p>
                              )}
                              <Button
                                className="inline-action"
                                variant="outline"
                                disabled={fxStatus?.state === 'loading'}
                                onClick={() => fxAutoFill.refresh(expense.id)}
                              >
                                重新讀取匯率
                              </Button>
                            </>
                          )}
                          <ExpenseCsv
                            date={expense.fxDate ?? ''}
                            currency={expense.currency}
                            context={expenseFxContext(expense)}
                            onImported={(q) => {
                              const current = latest.current;
                              const target = current.expenses.find(
                                (e) => e.id === expense.id,
                              );
                              if (
                                !target ||
                                expenseFxContext(target) !==
                                  expenseFxContext(expense)
                              )
                                throw new FxInputError(
                                  '費用或匯率資料已變更，請重新匯入。',
                                );
                              setDraft((previous) => ({
                                ...previous,
                                expenses: previous.expenses.map((e) =>
                                  e.id === expense.id &&
                                  expenseFxContext(e) ===
                                    expenseFxContext(expense)
                                    ? {
                                        ...e,
                                        fxRate: q.rate,
                                        fxDate: q.date,
                                        fxSource:
                                          target.fxSource === 'manual'
                                            ? 'manual'
                                            : q.source,
                                        manualBasis: 'bank',
                                        fxProofNote: q.proof,
                                        fxProvenance: 'imported',
                                        cashUnavailable: q.cashUnavailable,
                                        botUnavailable: false,
                                      }
                                    : e,
                                ),
                              }));
                            }}
                          />
                          <p className="field-hint">
                            {fxDate
                              ? `無結匯憑證時，請使用 ${fxDate} 的臺銀賣出報價；休市日往前查詢。`
                              : '請先填寫出差日期，以查詢適用匯率。'}
                          </p>
                          {fxReady && (
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingFx(null);
                                requestAnimationFrame(() =>
                                  document
                                    .getElementById(
                                      `expense-editor-${expense.id}`,
                                    )
                                    ?.querySelector<HTMLElement>(
                                      '.expense-fx-summary button',
                                    )
                                    ?.focus(),
                                );
                              }}
                            >
                              完成匯率
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {expense.category === 'insurance' && insuranceFields}
                  {expense.category === 'flight' && cabinFields}
                  {expense.category === 'registration' && approvalFields}
                  {['land', 'misc'].includes(expense.category) && (
                    <div className="checks">
                      <CheckField
                        path={`expenses.${index}.foreignTaxi`}
                        label="國外計程車費"
                        checked={expense.foreignTaxi}
                        onChange={(value) =>
                          patch(expense.id, {
                            foreignTaxi: value,
                            ...(value ? { category: 'misc' as const } : {}),
                          })
                        }
                        hint="國外計程車列入禮品交際及雜費，一般個人出差與其他雜費合計以每日 NT$1,100 計算總額上限。"
                      />
                    </div>
                  )}
                  <div className="expense-editor-footer">
                    <span>
                      {problems.length
                        ? `尚有 ${problems.length} 項資料待補`
                        : '此筆費用已填寫'}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => closeExpense(expense.id)}
                    >
                      收合費用
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {draft.expenses.length > 0 && !adding && (
        <Button
          variant="outline"
          className="add-expense"
          onClick={() => setAdding(true)}
        >
          <Plus size={16} />
          新增一筆費用
        </Button>
      )}
      {removed && (
        <div className="undo-notice" role="status">
          <span>已刪除一筆{CATEGORY_LABELS[removed.expense.category]}。</span>
          <Button variant="ghost" onClick={restore}>
            <Undo2 size={15} />
            復原
          </Button>
        </div>
      )}
    </>
  );
}
