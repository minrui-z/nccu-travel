import { useState, useRef, useEffect, useCallback } from 'react';
import { updateLivingFx } from '@/lib/expense-state';
import {
  CalendarDays,
  Merge,
  Split,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Area, Choice, CheckField } from './fields';
import { ConfirmChange } from './confirm-change';
import { DestinationPicker } from './destination-picker';
import { getLocation } from '@/lib/location-catalog';
import {
  applyDailyDestination,
  copyDutyDestination,
  editTransitEndpoint,
  hasTravelRoute,
  transitForDay,
  routePlaceLabel,
  changeDayKind,
  setProvidedMeal,
} from '@/lib/trip-locations';
import {
  autoGroupDays,
  mergeSelection,
  splitGroup,
  fxReferenceDate,
  fxDepartureDate,
} from '@/lib/claim/claim-engine';
import type { Calculation, DailyEntry } from '@/lib/claim/types';
import {
  allowanceFor,
  exactSnapshot,
  type Allowances,
  type FxIndex,
} from '@/lib/public-data';
import { parseBotCsvImport } from '@/scripts/bot-rates.mjs';
import type { WorkbenchDraft } from './model';
import { updateGroupDays, replaceGroupedDays } from '@/lib/trip-groups';
import {
  prepareTripDates,
  restoreTripGroups,
  livingFxCanAutoFill,
  describeTripDates,
  tripFormError,
} from '@/lib/trip-flow';
import { FxInputError, fxImportError, fxLookupError } from '@/lib/fx-errors';
import './trip-flow.css';

const dateRange = (days: DailyEntry[]) => {
  const first = days[0]?.date.slice(5).replace('-', '/') ?? '';
  const last = days.at(-1)?.date.slice(5).replace('-', '/') ?? '';
  return first === last ? first : `${first}–${last}`;
};
const kindLabel = (kind: DailyEntry['kind']) =>
  ({
    official: '會議／參訪',
    flight: '交通工具歇夜',
    return: '返國',
    personal: '私人行程',
  })[kind];

export function TripForm({
  draft,
  setDraft,
  allowances,
  fxInfo,
  calculation,
  focus,
  requestedPath,
}: {
  draft: WorkbenchDraft;
  setDraft: (
    d: WorkbenchDraft | ((previous: WorkbenchDraft) => WorkbenchDraft),
  ) => void;
  allowances: Allowances | null;
  fxInfo?: FxIndex | null;
  calculation: Calculation;
  focus: (s: string) => void;
  requestedPath?: string;
}) {
  const latest = useRef(draft);
  latest.current = draft;
  const [activeId, setActiveId] = useState(draft.days[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeMode, setMergeMode] = useState(false);
  const [groupUndo, setGroupUndo] = useState<WorkbenchDraft['groups'] | null>(
    null,
  );
  const [pendingDates, setPendingDates] = useState({
    start: draft.startDate,
    end: draft.endDate,
  });
  const [rateSettings, setRateSettings] = useState('');
  const [locationSettings, setLocationSettings] = useState('');
  const merge = mergeSelection(draft.days, draft.groups, selected);
  const [message, setMessage] = useState('');
  const [periodMessage, setPeriodMessage] = useState('');
  const [groupMessage, setGroupMessage] = useState('');
  const [dayMessage, setDayMessage] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [proofDate, setProofDate] = useState('');
  const proof = !!draft.fx.rateDate && proofDate === draft.fx.rateDate;
  const [loading, setLoading] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const fxAttempt = useRef('');
  const fxRequest = useRef(0);
  useEffect(() => {
    setPendingDates({ start: draft.startDate, end: draft.endDate });
    setGroupUndo(null);
    setSelected([]);
    setMergeMode(false);
  }, [draft.startDate, draft.endDate]);
  useEffect(() => {
    if (requestedPath) setMergeMode(false);
    const index = /^days\.(\d+)/.exec(requestedPath ?? '')?.[1];
    if (index !== undefined && draft.days[Number(index)])
      setActiveId(draft.days[Number(index)].id);
    if (index !== undefined && /usdRate|rateSource/.test(requestedPath ?? ''))
      setRateSettings(draft.days[Number(index)]?.id ?? '');
    if (index !== undefined && requestedPath?.endsWith('.location'))
      setLocationSettings(draft.days[Number(index)]?.id ?? '');
    const group = /^groups\.(\d+)/.exec(requestedPath ?? '')?.[1];
    const dayId =
      group === undefined ? undefined : draft.groups[Number(group)]?.dayIds[0];
    if (dayId) setActiveId(dayId);
    if (
      requestedPath?.startsWith('fx') ||
      requestedPath?.startsWith('approved')
    )
      setFxOpen(true);
  }, [requestedPath, draft.days, draft.groups]);
  const day = draft.days.find((x) => x.id === activeId) ?? draft.days[0];
  const dayPath = `days.${draft.days.findIndex((entry) => entry.id === day?.id)}`;
  const dc = calculation.daily.find((x) => x.id === day?.id);
  const current = draft.groups.findIndex((group) =>
    group.dayIds.includes(day?.id ?? ''),
  );
  const activeGroup = draft.groups[current];
  const activeDays = draft.days.filter((entry) =>
    activeGroup?.dayIds.includes(entry.id),
  );
  const groupCalculation = calculation.groups[current];
  const travelRoute = day ? hasTravelRoute(day) : false;
  const transit = day ? transitForDay(day) : { from: '', to: '' };
  const activate = (id: string) => {
    setActiveId(id);
    setDayMessage('');
    focus('day:' + id);
  };
  const updateDays = (
    days: DailyEntry[],
    extra: Partial<WorkbenchDraft> = {},
  ) => {
    setDraft({ ...replaceGroupedDays(draft, days), ...extra });
  };
  const editActive = (
    transform: (entry: DailyEntry) => DailyEntry,
    destinationId?: string,
  ) => {
    if (!day) return false;
    try {
      const next = updateGroupDays(draft, day.id, transform);
      if (destinationId !== undefined) {
        next.destinationIds = { ...draft.destinationIds };
        activeDays.forEach((entry) => {
          next.destinationIds![entry.id] = destinationId;
        });
      }
      setDraft(next);
      setDayMessage('');
      focus('day:' + day.id);
      return true;
    } catch (error) {
      setDayMessage(tripFormError(error));
      return false;
    }
  };
  const patchDay = (patch: Partial<DailyEntry>) =>
    editActive((entry) => ({ ...entry, ...patch }));
  const pendingChanged =
    pendingDates.start !== draft.startDate ||
    pendingDates.end !== draft.endDate ||
    !draft.days.length;
  const removedDates = draft.days.filter(
    (entry) => entry.date < pendingDates.start || entry.date > pendingDates.end,
  );
  const affectedExpenses = draft.expenses.filter(
    (expense) =>
      expense.date < pendingDates.start || expense.date > pendingDates.end,
  );
  const generate = () => {
    try {
      const result = prepareTripDates(latest.current, pendingDates);
      setDraft((previous) => prepareTripDates(previous, pendingDates).draft);
      setActiveId(result.draft.days[0].id);
      setSelected([]);
      setGroupUndo(null);
      setMergeMode(false);
      setPeriodMessage(
        result.affectedExpenses.length
          ? `日期已更新。${result.affectedExpenses.length} 筆費用的列入日期在新範圍外，請至費用頁核對。`
          : '行程日期已套用，原有日期的內容已保留。',
      );
    } catch (e) {
      setPeriodMessage(tripFormError(e));
    }
  };
  const selectCity = (id: string) => {
    if (!day || day.kind === 'personal' || !allowances) return;
    try {
      if (
        !editActive((entry) => applyDailyDestination(entry, allowances, id), id)
      )
        return;
      if (id) setRateSettings('');
      const found = id ? allowanceFor(allowances, id, day.date) : null;
      setDayMessage(
        found
          ? found.fallback
            ? '此季節改採 ' + found.label + ' 的日支額。'
            : '已套用官方日支額 USD ' + found.amount + '。'
          : '請選擇城市。',
      );
      focus('day:' + day.id);
    } catch (e) {
      setDayMessage(tripFormError(e));
    }
  };
  const setEndpoint = (side: 'from' | 'to', text: string, id = '') => {
    if (!day) return;
    editActive((entry) => editTransitEndpoint(entry, side, text, id));
  };
  const city =
    day && allowances && draft.destinationIds?.[day.id]
      ? allowanceFor(allowances, draft.destinationIds[day.id], day.date)
      : null;
  const locationChoice = allowances?.destinations.find(
    (item) => item.id === draft.destinationIds?.[day?.id ?? ''],
  );
  const groupAction = (action: () => WorkbenchDraft['groups']) => {
    try {
      const nextGroups = action();
      setGroupUndo(draft.groups);
      setDraft({ ...draft, groups: nextGroups });
      setSelected([]);
      setMergeMode(false);
      setGroupMessage('日期分欄已更新。');
    } catch (e) {
      setGroupMessage(tripFormError(e));
    }
  };
  const fetchRate = useCallback(
    async (automatic = false) => {
      const request = ++fxRequest.current;
      const starting = latest.current;
      const startingFx = JSON.stringify(starting.fx);
      setLoading(true);
      try {
        const selectedDate = !automatic && starting.fx.rateDate;
        const date = selectedDate || fxReferenceDate(fxDepartureDate(starting));
        if (!date) throw new FxInputError('請先設定出發日期。');
        const snapshot = await exactSnapshot(date);
        const rate = snapshot.currencyRates.USD?.cashSelling;
        if (!rate)
          throw new FxInputError(
            '該日沒有美元現金賣出資料。請匯入臺銀匯率檔，或依證明填寫。',
          );
        if (
          request !== fxRequest.current ||
          fxDepartureDate(latest.current) !== fxDepartureDate(starting) ||
          JSON.stringify(latest.current.fx) !== startingFx
        )
          return;
        setDraft((previous) => {
          if (
            fxDepartureDate(previous) !== fxDepartureDate(starting) ||
            JSON.stringify(previous.fx) !== startingFx
          )
            return previous;
          return {
            ...previous,
            fx: {
              rate,
              rateDate: date,
              source: 'bot',
              proofNote: snapshot.sourceUrl,
              provenance: selectedDate ? 'manual' : 'automatic',
            },
          };
        });
        setMessage('已套用 ' + date + ' 臺銀美元現金賣出。');
        if (automatic) setFxOpen(false);
      } catch (error) {
        if (
          request !== fxRequest.current ||
          fxDepartureDate(latest.current) !== fxDepartureDate(starting) ||
          JSON.stringify(latest.current.fx) !== startingFx
        )
          return;
        setMessage(fxLookupError(error));
        setFxOpen(true);
      } finally {
        if (request === fxRequest.current) setLoading(false);
      }
    },
    [setDraft],
  );
  const autoFxKey = `${fxDepartureDate(draft)}|${livingFxCanAutoFill(draft)}`;
  useEffect(() => {
    if (!livingFxCanAutoFill(latest.current)) {
      fxAttempt.current = '';
      return;
    }
    if (!fxReferenceDate(fxDepartureDate(latest.current))) return;
    if (fxAttempt.current === autoFxKey) return;
    fxAttempt.current = autoFxKey;
    void fetchRate(true);
  }, [autoFxKey, fetchRate]);
  const importCsv = async (file: File) => {
    try {
      if (!proof || !draft.fx.rateDate)
        throw new FxInputError('請填報價日期並勾選已核對官方日期證明。');
      if (file.size > 1000000)
        throw new FxInputError('檔案超過 1 MB，請選擇臺銀原始匯率檔。');
      const parsed = parseBotCsvImport(await file.text(), {
        filename: file.name,
        targetDate: draft.fx.rateDate || undefined,
        dateProofConfirmed: proof,
      });
      const rate = parsed.currencyRates.USD?.cashSelling;
      if (!rate)
        throw new FxInputError(
          '檔案未提供美元現金賣出報價，請確認選擇的匯率檔。',
        );
      if (
        fxDepartureDate(latest.current) !== fxDepartureDate(draft) ||
        JSON.stringify(latest.current.fx) !== JSON.stringify(draft.fx)
      )
        throw new FxInputError('行程或匯率日期已更新，請重新匯入。');
      setDraft((previous) => {
        if (
          fxDepartureDate(previous) !== fxDepartureDate(draft) ||
          JSON.stringify(previous.fx) !== JSON.stringify(draft.fx)
        )
          return previous;
        return {
          ...previous,
          fx: {
            rate,
            rateDate: parsed.quotationDate,
            source: 'bot',
            proofNote: '臺銀匯率檔：' + file.name + '；報價日期已核對',
            provenance: 'imported',
          },
        };
      });
      setMessage('已匯入 ' + parsed.quotationDate + ' 臺銀匯率。');
    } catch (e) {
      setMessage(fxImportError(e));
    }
  };
  return (
    <>
      <div className="section-heading">
        <span className="section-symbol">
          <CalendarDays />
        </span>
        <div>
          <h2>行程與生活費</h2>
          <p>以當地日期記錄，返國日不計住宿費。</p>
        </div>
      </div>
      <div className="fields" data-field-path="days" tabIndex={-1}>
        <Field
          label="實際出發日期"
          type="date"
          path="startDate"
          value={pendingDates.start}
          onChange={(start) => {
            setPendingDates((range) => ({ ...range, start }));
            setPeriodMessage('');
          }}
        />
        <Field
          label="實際返國日期"
          type="date"
          path="endDate"
          value={pendingDates.end}
          onChange={(end) => {
            setPendingDates((range) => ({ ...range, end }));
            setPeriodMessage('');
          }}
        />
      </div>
      <Button
        className="inline-action"
        variant="outline"
        disabled={!pendingChanged}
        onClick={() => {
          try {
            const prepared = prepareTripDates(draft, pendingDates);
            if (prepared.removed.length) setReplaceOpen(true);
            else generate();
          } catch (error) {
            setPeriodMessage(tripFormError(error));
          }
        }}
      >
        <RefreshCw size={15} />
        {draft.days.length ? '套用日期' : '建立行程'}
      </Button>
      {pendingChanged && draft.days.length > 0 && (
        <div className="trip-pending-actions" role="status">
          <span>日期尚未套用，下方仍顯示原行程。</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPendingDates({ start: draft.startDate, end: draft.endDate });
              setPeriodMessage('');
            }}
          >
            取消修改
          </Button>
        </div>
      )}
      {periodMessage && (
        <p className="inline-status" role="status">
          {periodMessage}
        </p>
      )}
      <ConfirmChange
        open={replaceOpen}
        onClose={() => {
          setReplaceOpen(false);
          setPendingDates({
            start: latest.current.startDate,
            end: latest.current.endDate,
          });
        }}
        onConfirm={generate}
        title="調整行程日期？"
        confirmLabel="套用日期"
        description={`將移除 ${removedDates.length} 天的行程內容：${describeTripDates(removedDates.map((entry) => entry.date))}。${affectedExpenses.length ? `另有 ${affectedExpenses.length} 筆費用的列入日期在新範圍外（${describeTripDates([...new Set(affectedExpenses.map((expense) => expense.date))].sort((a, b) => a.localeCompare(b)))}）。費用完整保留，請稍後核對列入日期。` : '已填費用與保留日期的內容不變。'}`}
      />
      {draft.days.length > 0 && (
        <>
          <div className="form-divider" />
          <div className="subheading-row">
            <h3 className="subheading">日期欄位</h3>
            <span
              className={
                'count-tag ' + (draft.groups.length > 12 ? 'over' : '')
              }
            >
              {draft.groups.length} 個日期欄
            </span>
          </div>
          <p className="field-hint">
            {mergeMode
              ? '勾選相鄰且地點、工作與膳宿相同的日期。'
              : '點日期編輯；已合併的日期會一起修改。'}
          </p>
          <div
            className={`date-groups ${mergeMode ? 'merge-mode' : 'edit-mode'}`}
            data-field-path="groups"
            tabIndex={-1}
          >
            {draft.groups.map((g, index) => {
              const entries = draft.days.filter((entry) =>
                g.dayIds.includes(entry.id),
              );
              const range = dateRange(entries);
              return (
                <div
                  className={
                    'date-group ' +
                    (!mergeMode && g.id === activeGroup?.id ? 'current ' : '') +
                    (selected.includes(g.id) ? 'is-selected' : '')
                  }
                  key={g.id}
                >
                  {mergeMode && (
                    <CheckField
                      label={<span className="sr-only">選取 {range}</span>}
                      checked={selected.includes(g.id)}
                      onChange={(checked) =>
                        setSelected((ids) =>
                          checked
                            ? [...new Set([...ids, g.id])]
                            : ids.filter((id) => id !== g.id),
                        )
                      }
                    />
                  )}
                  <button
                    className="date-group-edit"
                    aria-label={
                      (mergeMode ? '選取 ' : '編輯 ') +
                      range +
                      '，' +
                      entries.length +
                      ' 天'
                    }
                    aria-pressed={
                      mergeMode
                        ? selected.includes(g.id)
                        : g.id === activeGroup?.id
                    }
                    onClick={() =>
                      mergeMode
                        ? setSelected((ids) =>
                            ids.includes(g.id)
                              ? ids.filter((id) => id !== g.id)
                              : [...ids, g.id],
                          )
                        : activate(g.dayIds[0])
                    }
                  >
                    <strong>{range}</strong>
                    <span>
                      {kindLabel(entries[0]?.kind ?? 'official')} ·{' '}
                      {entries.length} 天
                    </span>
                    <small>第 {index + 1} 欄</small>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="button-row">
            {!mergeMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMergeMode(true);
                  setSelected([]);
                  setGroupMessage('');
                }}
              >
                <Merge size={14} />
                合併日期
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => groupAction(() => merge.groups)}
                  disabled={!merge.canMerge}
                  aria-describedby="merge-selection-state"
                >
                  <Merge size={14} />
                  合併選取
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => groupAction(() => autoGroupDays(draft.days))}
                >
                  合併所有相同條件
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelected([]);
                    setMergeMode(false);
                  }}
                >
                  取消
                </Button>
              </>
            )}
            {!mergeMode && groupUndo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  try {
                    setDraft(restoreTripGroups(draft, groupUndo));
                    setGroupUndo(null);
                    setGroupMessage('已復原日期分欄。');
                  } catch (error) {
                    setGroupMessage(tripFormError(error));
                  }
                }}
              >
                <Undo2 size={14} />
                復原分欄
              </Button>
            )}
          </div>
          {(mergeMode || groupMessage) && (
            <p
              id="merge-selection-state"
              className={
                'selection-status ' +
                (merge.count > 1 && !merge.canMerge ? 'selection-error' : '')
              }
              aria-live="polite"
            >
              {!mergeMode
                ? groupMessage
                : merge.count === 0
                  ? '請勾選要合併的日期。'
                  : merge.count === 1
                    ? '已選 1 欄，請再選取相鄰且條件相同的日期欄。'
                    : merge.reason}
            </p>
          )}
          {day && !mergeMode && (
            <div
              className="daily-panel"
              data-field-path={dayPath}
              tabIndex={-1}
            >
              <div className="daily-heading">
                <div>
                  <h3>{dateRange(activeDays)}</h3>
                  <p className="edit-scope">
                    {activeDays.length > 1
                      ? `本欄 ${activeDays.length} 天同步修改`
                      : '編輯此日行程'}
                  </p>
                </div>
                <div className="button-row">
                  {activeDays.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        groupAction(() =>
                          splitGroup(draft.groups, activeGroup.id),
                        )
                      }
                    >
                      <Split size={14} />
                      拆開此欄
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="上一個日期欄"
                    disabled={current <= 0}
                    onClick={() =>
                      activate(draft.groups[current - 1].dayIds[0])
                    }
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="下一個日期欄"
                    disabled={current === draft.groups.length - 1}
                    onClick={() =>
                      activate(draft.groups[current + 1].dayIds[0])
                    }
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
              {dayMessage && (
                <p className="inline-status day-status" role="status">
                  {dayMessage}
                </p>
              )}
              <div className="fields">
                <Choice
                  label="行程類型"
                  path={dayPath + '.kind'}
                  value={day.kind}
                  options={[
                    ['official', '出差、會議或參訪'],
                    ['flight', '在交通工具上歇夜'],
                    ['return', '返國日'],
                    ['personal', '私人行程，不請領'],
                  ]}
                  onChange={(v) => {
                    const kind = v as DailyEntry['kind'];
                    const route = transitForDay(day);
                    editActive(
                      (entry) => changeDayKind(entry, kind, route),
                      kind === 'personal' ? '' : undefined,
                    );
                  }}
                  full
                />
                {day.kind === 'personal' && (
                  <Field
                    label="地點"
                    required={false}
                    path={dayPath + '.location'}
                    value={day.location}
                    onChange={(value) => patchDay({ location: value })}
                    placeholder="國家、城市或起訖地點"
                    hint="填寫後列入原表起訖地點欄，不帶入日支額。"
                    full
                    onFocus={() => focus('day:' + day.id)}
                  />
                )}
                {day.kind !== 'personal' && (
                  <>
                    {travelRoute && (
                      <div className="transit-route full">
                        {(['from', 'to'] as const).map((side) => {
                          const label = side === 'from' ? '起點' : '迄點';
                          const selectedId =
                            (side === 'from' ? transit.fromId : transit.toId) ??
                            '';
                          return (
                            <div className="transit-endpoint" key={side}>
                              <DestinationPicker
                                key={day.id + side}
                                data={allowances}
                                value={selectedId}
                                label={label}
                                route
                                hint=""
                                onChange={(id) => {
                                  const place = getLocation(
                                    allowances,
                                    id,
                                    true,
                                  );
                                  const preciseCity =
                                    place &&
                                    place.city !== '全國' &&
                                    place.city !== '其他';
                                  setEndpoint(
                                    side,
                                    preciseCity ? routePlaceLabel(place) : '',
                                    id,
                                  );
                                }}
                              />
                              <Field
                                label={label + '地點'}
                                path={dayPath + '.transit.' + side}
                                value={transit[side]}
                                onChange={(value) => setEndpoint(side, value)}
                                placeholder="可選上方城市，或自行填寫國家與城市"
                                hint="可補充機場、轉機地點；未列城市請自行填寫。"
                                full
                                onFocus={() => focus('day:' + day.id)}
                              />
                            </div>
                          );
                        })}
                        <p className="route-summary">
                          <span>表內起訖地點</span>
                          {day.location || '請填寫起點與迄點'}
                        </p>
                      </div>
                    )}
                    {!travelRoute && (
                      <DestinationPicker
                        key={day.id + (travelRoute ? '-allowance' : '-lodging')}
                        data={allowances}
                        value={draft.destinationIds?.[day.id] ?? ''}
                        label="留宿地點"
                        hint="選擇留宿城市後帶入日支額；未列城市請選該國「其他」，並在下方填寫實際城市。"
                        onChange={selectCity}
                      />
                    )}
                    {!travelRoute &&
                      (!day.location ||
                      locationChoice?.isCountryOther ||
                      locationSettings === day.id ? (
                        <Field
                          label="報表上的地點"
                          path={dayPath + '.location'}
                          value={day.location}
                          onChange={(v) => patchDay({ location: v })}
                          placeholder="國家、城市"
                          hint="由上方帶入，可補充實際城市或住宿地點。"
                          full
                          onFocus={() => focus('day:' + day.id)}
                        />
                      ) : (
                        <div className="trip-location-summary full">
                          <span>
                            報表地點<strong>{day.location}</strong>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocationSettings(day.id)}
                          >
                            修改地點
                          </Button>
                        </div>
                      ))}
                    <details
                      className="trip-rate-settings full"
                      open={rateSettings === day.id || !day.usdRate}
                      onToggle={(event) => {
                        if (event.currentTarget.open) setRateSettings(day.id);
                        else setRateSettings('');
                      }}
                    >
                      <summary>
                        <span>
                          生活費日支額
                          <strong>
                            {day.usdRate
                              ? `USD ${day.usdRate}`
                              : '請選擇適用地區'}
                          </strong>
                        </span>
                        <span>
                          {city?.label ??
                            (day.rateSource === 'manual'
                              ? '依填寫的證明'
                              : '查看與修改')}
                          <ChevronRight size={15} />
                        </span>
                      </summary>
                      {travelRoute && (
                        <DestinationPicker
                          key={day.id + '-allowance'}
                          data={allowances}
                          value={draft.destinationIds?.[day.id] ?? ''}
                          label="日支額適用地區"
                          hint="依當日行程選用適用地區，與上方起迄地點分開記錄。"
                          onChange={selectCity}
                        />
                      )}
                      <div className="fields">
                        <Field
                          label="當地日支數額（USD）"
                          path={dayPath + '.usdRate'}
                          value={day.usdRate}
                          onChange={(v) => {
                            editActive(
                              (entry) => ({
                                ...entry,
                                usdRate: v,
                                rateSource: 'manual',
                              }),
                              '',
                            );
                          }}
                          hint="手動改值時，請留存官方依據。"
                          onFocus={() => focus('day:' + day.id)}
                        />
                        {day.rateSource === 'manual' && (
                          <Area
                            label="手動日支額的官方依據"
                            path={dayPath + '.usdRateProof'}
                            value={day.usdRateProof ?? ''}
                            onChange={(v) => patchDay({ usdRateProof: v })}
                            placeholder="官方日支額表網址、頁碼；未列城市的適用理由"
                          />
                        )}
                      </div>
                      {city?.source && (
                        <a
                          className="source-link"
                          target="_blank"
                          rel="noreferrer"
                          href={city.source.url}
                        >
                          日支額依據・第 {city.page} 頁
                          {city.fallback ? '（採該國其他地區）' : ''}
                        </a>
                      )}
                    </details>
                    <Area
                      label="工作記要"
                      path={dayPath + '.work'}
                      value={day.work}
                      onChange={(v) => patchDay({ work: v })}
                      full
                      placeholder="會議、參訪或工作內容"
                      hint="可換行，表格會自動調整文字大小。"
                      onFocus={() => focus('day:' + day.id)}
                    />
                  </>
                )}
              </div>
              {day.kind === 'personal' ? (
                <p className="field-hint">
                  工作記要填入「個人行程」，生活費及其他請領欄留空。
                </p>
              ) : (
                <>
                  {day.kind === 'official' && (
                    <Button
                      className="inline-action"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        try {
                          const id = draft.destinationIds?.[day.id] ?? '';
                          const destinationIds = { ...draft.destinationIds };
                          const days = draft.days.map((d) => {
                            if (d.kind === 'official')
                              destinationIds[d.id] = id;
                            return copyDutyDestination(day, d, allowances, id);
                          });
                          updateDays(days, { destinationIds });
                          setDayMessage('已套用至其他出差日。');
                        } catch (e) {
                          setDayMessage(tripFormError(e));
                        }
                      }}
                    >
                      <Copy size={14} />
                      套用地點與工作至其他出差日
                    </Button>
                  )}
                  <h4 className="minor-heading">免費提供或費用已含的膳宿</h4>
                  <div className="meal-grid">
                    {day.kind === 'official' && (
                      <CheckField
                        label="住宿 70%"
                        checked={day.lodgingProvided}
                        onChange={(v) => patchDay({ lodgingProvided: v })}
                      />
                    )}
                    <CheckField
                      label="早餐 4%"
                      checked={!day.mealsInFlight && day.breakfast}
                      onChange={(v) =>
                        editActive((entry) =>
                          setProvidedMeal(entry, 'breakfast', v),
                        )
                      }
                    />
                    <CheckField
                      label="午餐 8%"
                      checked={!day.mealsInFlight && day.lunch}
                      onChange={(v) =>
                        editActive((entry) =>
                          setProvidedMeal(entry, 'lunch', v),
                        )
                      }
                    />
                    <CheckField
                      label="晚餐 8%"
                      checked={!day.mealsInFlight && day.dinner}
                      onChange={(v) =>
                        editActive((entry) =>
                          setProvidedMeal(entry, 'dinner', v),
                        )
                      }
                    />
                  </div>
                  <p className="field-hint">
                    {travelRoute && '此日不計住宿費。'}
                    勾選免費提供或費用已包含的項目。航程供餐不需勾選。
                  </p>
                  <details className="meal-guidance">
                    <summary>膳宿扣除說明</summary>
                    <p className="field-hint">
                      主辦方供餐、報名費或依第八點核准檢據住宿已含的餐食，須勾選扣除。一般自行住宿早餐請依適用規則核對；同日另有會議供餐時，只勾選會議餐食。
                    </p>
                  </details>
                  <Field
                    label="其他應扣生活費（USD）"
                    path={dayPath + '.extraDeductionUsd'}
                    value={day.extraDeductionUsd}
                    onChange={(v) => patchDay({ extraDeductionUsd: v })}
                    placeholder="無則留白"
                    hint="請將扣款原因記在備註。"
                  />
                  <div className="daily-result">
                    <span>
                      {activeDays.length > 1
                        ? `本欄生活費（${activeDays.length} 天）`
                        : '當日生活費'}
                      <small>{dc?.reason}</small>
                    </span>
                    <strong>
                      <small>USD</small>{' '}
                      {groupCalculation?.netUsd ?? dc?.netUsd ?? '—'}
                    </strong>
                  </div>
                  <p className="formula">
                    {activeDays.length > 1
                      ? `${dc?.formula ?? ''}；共 ${activeDays.length} 天`
                      : dc?.formula}
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
      <div className="form-divider" />
      <details
        className="details-panel fx-panel"
        data-field-path="fx"
        tabIndex={-1}
        open={fxOpen}
        onToggle={(event) => setFxOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="trip-fx-title">
            生活費匯率
            <small>
              {loading
                ? '正在查詢'
                : draft.fx.rateDate
                  ? `${draft.fx.rateDate} · ${draft.fx.provenance === 'imported' ? '匯入臺銀資料' : draft.fx.source === 'receipt' ? '結匯證明' : draft.fx.source === 'manual' ? '依證明填寫' : '臺銀現金賣出'}`
                  : '依出發日期查詢，可另外選用結匯證明'}
            </small>
          </span>
          <span className="trip-fx-value">
            {draft.fx.rate
              ? `USD 1 ＝ NT$ ${draft.fx.rate}`
              : loading
                ? '查詢中…'
                : '尚未取得'}
          </span>
          <ChevronRight size={16} className="details-chevron" />
        </summary>
        <p className="field-hint">
          有效美元結匯證明優先；否則採奉派出差前一日的臺銀美元現金賣出，假日往前。其他檢據費用可各自選匯率。
        </p>
        {fxInfo && (
          <p className="field-hint">
            可查詢 {fxInfo.earliestQuotationDate} 至{' '}
            {fxInfo.latestQuotationDate}，共 {fxInfo.availableDates.length}{' '}
            個官方報價日。
          </p>
        )}
        <Field
          label="匯率基準出發日"
          type="date"
          path="approvedStart"
          value={fxDepartureDate(draft)}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, approvedStart: value }))
          }
          hint="通常與出發日期相同；若先有私人行程，請填核定出差的出發日。"
        />
        <div className="rate-reference">
          <span>奉派日前一營業日參考</span>
          <strong>{calculation.fxReferenceDate ?? '尚未設定'}</strong>
          <small>已排除週末；臺灣休市日仍須核對。</small>
        </div>
        <div className="fields">
          <Choice
            label="生活費匯率依據"
            path="fx.source"
            value={draft.fx.source}
            options={[
              ['bot', '臺灣銀行美元現金賣出'],
              ['receipt', '有效美元結匯證明'],
              ['manual', '手動輸入並附依據'],
            ]}
            onChange={(v) =>
              setDraft({
                ...draft,
                fx: updateLivingFx(draft.fx, {
                  source: v as WorkbenchDraft['fx']['source'],
                }),
              })
            }
          />
          <Field
            label="每 1 美元折合臺幣"
            path="fx.rate"
            value={draft.fx.rate}
            onChange={(v) =>
              setDraft({
                ...draft,
                fx: updateLivingFx(draft.fx, {
                  rate: v,
                  provenance: 'manual',
                  ...(draft.fx.source === 'bot'
                    ? { source: 'manual', manualBasis: 'bank' }
                    : {}),
                }),
              })
            }
          />
          <Field
            label="報價／結匯日期"
            type="date"
            path="fx.rateDate"
            value={draft.fx.rateDate}
            onChange={(v) =>
              setDraft({
                ...draft,
                fx: updateLivingFx(draft.fx, {
                  rateDate: v,
                  provenance: 'manual',
                }),
              })
            }
          />
          <div className="align-bottom">
            <Button
              variant="outline"
              onClick={() => void fetchRate()}
              disabled={loading}
            >
              {loading ? '查詢中…' : '查詢並填入銀行匯率'}
            </Button>
          </div>
          {draft.fx.source === 'manual' && (
            <Choice
              label="手動匯率的證明種類"
              path="fx.manualBasis"
              value={draft.fx.manualBasis ?? 'bank'}
              options={[
                ['bank', '指定日期的銀行報價'],
                ['receipt', '有效期間內的結匯證明'],
              ]}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  fx: updateLivingFx(draft.fx, {
                    manualBasis: v as 'bank' | 'receipt',
                  }),
                })
              }
              full
            />
          )}
          <Area
            label="匯率依據與假日說明"
            path="fx.proofNote"
            value={draft.fx.proofNote}
            onChange={(v) =>
              setDraft({
                ...draft,
                fx: { ...draft.fx, proofNote: v, provenance: 'manual' },
              })
            }
            placeholder="官方網址、結匯證明或休市證明"
            hint="結匯證明須介於奉派出差日前 15 日至返國日。"
          />
        </div>
        <details className="details-panel">
          <summary>匯入臺銀匯率檔（CSV）</summary>
          <p className="field-hint">
            先填報價日期。若檔名不含日期，需依下載頁或證明核對；檔案不會上傳。
          </p>
          <CheckField
            label="已核對 CSV 的報價日期與上方日期一致"
            checked={proof}
            onChange={(value) => setProofDate(value ? draft.fx.rateDate : '')}
          />
          <label className="file-input-label">
            選擇官方 CSV
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="匯入官方匯率 CSV"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importCsv(f);
                e.target.value = '';
              }}
            />
          </label>
          <a
            className="source-link"
            href="https://rate.bot.com.tw/xrt/history?Lang=zh-TW"
            target="_blank"
            rel="noreferrer"
          >
            開啟臺灣銀行歷史匯率
          </a>
        </details>
        {message && (
          <p className="inline-status" role="status">
            {message}
          </p>
        )}
      </details>
    </>
  );
}
