import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '@/lib/paths';
import type { Calculation, Draft, Issue } from '@/lib/claim/types';
import type { TemplateManifest } from '@/lib/xls/template-types';
import { templateIdFor } from '@/lib/xls/template-selection';
import { buildClaimChanges } from '@/lib/xls/claim-mapping';
import { fitClaimText } from '@/lib/xls/text-fitting';
import { capacityIssuesForDraft } from '@/lib/issue-navigation';

export function useReport(draft: Draft, calculation: Calculation, retry = 0) {
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [error, setError] = useState('');
  const segments = Math.max(1, Math.min(draft.groups.length || (draft.template === 'general' ? 6 : 7), 12));
  const templateId = templateIdFor(draft, segments);
  useEffect(() => {
    let alive = true;
    setManifest(null);
    setError('');
    void fetchJson<TemplateManifest>('templates/' + templateId + '.json')
      .then((value) => {
        if (!alive) return;
        if (value.kind !== draft.template || value.segmentCount !== segments || !value.sheets.length) throw new Error('Invalid form');
        setManifest(value);
      })
      .catch(() => { if (alive) setError('報表載入失敗，請重試。'); });
    return () => { alive = false; };
  }, [draft.template, segments, templateId, retry]);
  const mapped = useMemo(() => {
    if (!manifest) return { manifest: null, changes: {}, errors: [] as Issue[] };
    try {
      const fitted = fitClaimText(manifest, buildClaimChanges(draft, calculation, manifest));
      return { manifest: fitted.manifest, changes: fitted.changes, errors: capacityIssuesForDraft(fitted.issues, draft) };
    } catch {
      return { manifest, changes: {}, errors: [{ code: 'export-layout', severity: 'error' as const, path: 'notes', message: '報表內容無法顯示，請重新載入後再試。' }] };
    }
  }, [draft, calculation, manifest]);
  return { manifest, mapped, error };
}
