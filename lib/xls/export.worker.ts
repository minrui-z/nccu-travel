import { calculateClaim } from '../claim/claim-engine';
import { patchXls } from './xls-exporter';
import { buildClaimChanges } from './claim-mapping';
import { fitClaimText } from './text-fitting';
import { verifyTemplateDigest } from './template-manifest';
import type { TemplateManifest } from './template-manifest';
import type { ReportErrorCode } from '../report-errors';
import type { Draft } from '../claim/types';

self.onmessage = async (
  event: MessageEvent<{
    draft: Draft;
    manifest: TemplateManifest;
    template: ArrayBuffer;
  }>,
) => {
  let failureCode: ReportErrorCode = 'invalid-claim';
  try {
    const { draft, manifest, template } = event.data;
    const calculation = calculateClaim(draft);
    if (!calculation.canExport)
      throw new Error(
        calculation.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join('；'),
      );
    if (calculation.groups.length !== manifest.segmentCount)
      throw new Error('日期欄數與模板不一致，請重新載入。');
    failureCode = 'template';
    await verifyTemplateDigest(new Uint8Array(template), manifest.sha256);
    failureCode = 'layout';
    const changes = buildClaimChanges(draft, calculation, manifest);
    const fit = fitClaimText(manifest, changes);
    if (fit.issues.length)
      throw new Error(fit.issues.map((e) => e.message).join('；'));
    failureCode = 'file';
    const result = patchXls(
      new Uint8Array(template),
      fit.changes,
      fit.formatting,
    );
    const buffer = Uint8Array.from(result).buffer;
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch {
    self.postMessage({ error: failureCode });
  }
};
