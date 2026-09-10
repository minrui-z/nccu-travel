import { isDraft } from '../lib/draft-schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createEmptyDraft } from '@/lib/claim/claim-engine';
import { readLocal, writeLocal, writeLocalBatch } from '@/lib/storage';
import type { WorkbenchDraft } from './model';
import { normalizePrivateDays } from '@/lib/trip-locations';
import { normalizeDraftTransition } from '@/lib/draft-transitions';
import { normalizeFxProvenance } from '@/lib/fx-provenance';

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'paused' | 'error';
const labels: Record<SaveStatus, string> = {
  loading: '讀取草稿…', saving: '儲存中…', saved: '已儲存',
  paused: '舊草稿無法讀取，自動儲存已暫停。重新填寫前會保留原資料。',
  error: '草稿儲存失敗，請保留此頁面後重試。',
};
const normalize = (value: WorkbenchDraft): WorkbenchDraft => normalizeFxProvenance(normalizePrivateDays({
  ...value, funding: { ...createEmptyDraft().funding!, ...value.funding },
}));

export function useDraft() {
  const [draft, update] = useState<WorkbenchDraft>(createEmptyDraft);
  const [ready, setReady] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [saveMessage, setSaveMessage] = useState('');
  const [hasPrevious, setHasPrevious] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const current = useRef(draft);
  current.current = draft;
  const operation = useRef(0);
  const replacingRef = useRef(false);
  const edited = useRef(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([readLocal<unknown>('active-draft'), readLocal<unknown>('previous-draft')])
      .then(([saved, previous]) => {
        if (!alive) return;
        setHasPrevious(isDraft(previous));
        if (saved !== undefined && !isDraft(saved)) { setSaveStatus('paused'); return; }
        if (saved !== undefined) update(normalize(saved as WorkbenchDraft));
        setCanPersist(true);
        setSaveStatus('saved');
      })
      .catch(() => {
        if (!alive) return;
        setSaveStatus('error');
        setSaveMessage('此瀏覽器無法讀取草稿，請保留此頁面後重試。');
      })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready || !canPersist || replacingRef.current) return;
    const revision = ++operation.current;
    setSaveStatus('saving');
    setSaveMessage('');
    void writeLocal('active-draft', draft)
      .then(() => { if (operation.current === revision) setSaveStatus('saved'); })
      .catch(() => { if (operation.current === revision) setSaveStatus('error'); });
  }, [draft, ready, canPersist]);

  const saveState = saveMessage || labels[saveStatus];
  useEffect(() => {
    if (saveStatus === 'error' || saveStatus === 'paused') { setAnnouncement(saveState); return; }
    if (saveStatus !== 'saved') return;
    const timer = setTimeout(() => setAnnouncement('草稿已儲存。'), 1500);
    return () => clearTimeout(timer);
  }, [saveStatus, saveState]);

  const performReplacement = async (getNext: () => WorkbenchDraft | Promise<WorkbenchDraft>): Promise<boolean> => {
    if (!ready || replacingRef.current) return false;
    replacingRef.current = true;
    setReplacing(true);
    ++operation.current;
    setSaveStatus('saving');
    setSaveMessage('');
    try {
      const incoming = await getNext();
      const previous = canPersist ? current.current : await readLocal<unknown>('active-draft');
      const next = normalize(incoming);
      const entries: Array<[string, unknown]> = [['active-draft', next]];
      if (previous !== undefined) entries.push(['previous-draft', previous]);
      await writeLocalBatch(entries);
      current.current = next;
      update(next);
      setHasPrevious(isDraft(previous));
      setCanPersist(true);
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('error');
      setSaveMessage('無法保存原草稿，目前內容已保留。請重試。');
      return false;
    } finally {
      replacingRef.current = false;
      setReplacing(false);
    }
  };
  const replaceDraft = (incoming: WorkbenchDraft) => performReplacement(() => incoming);
  const restoreDraft = () => performReplacement(async () => {
    const previous = await readLocal<unknown>('previous-draft');
    if (!isDraft(previous)) throw new Error('No recoverable draft');
    return previous;
  });
  const setDraft = useCallback((next: WorkbenchDraft | ((previous: WorkbenchDraft) => WorkbenchDraft)) => {
    if (replacingRef.current) return;
    edited.current = true;
    update((previous) => normalizeFxProvenance(normalizeDraftTransition(previous,
      typeof next === 'function' ? next(previous) : next,
    )));
  }, []);
  const retrySave = async () => {
    if (canPersist) { update((previous) => ({ ...previous })); return; }
    if (edited.current) { await replaceDraft(current.current); return; }
    if (replacingRef.current) return;
    replacingRef.current = true;
    setReplacing(true);
    setSaveStatus('loading');
    setSaveMessage('');
    try {
      const saved = await readLocal<unknown>('active-draft');
      if (saved !== undefined && !isDraft(saved)) { setSaveStatus('paused'); return; }
      if (saved !== undefined) update(normalize(saved as WorkbenchDraft));
      setCanPersist(true);
      setSaveStatus('saved');
      setHasPrevious(isDraft(await readLocal('previous-draft')));
    } catch {
      setSaveStatus('error');
      setSaveMessage('此瀏覽器仍無法讀取草稿，請保留此頁面後重試。');
    } finally { replacingRef.current = false; setReplacing(false); }
  };
  return { draft, setDraft, replaceDraft, restoreDraft, hasPrevious, ready, replacing,
    saveState, saveStatus, announcement, retrySave };
}
