import type { Calculation } from '@/lib/claim/types';
export function registerClaimTools(
  getCalculation: () => Calculation,
): () => void {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (
          tool: {
            name: string;
            title: string;
            description: string;
            inputSchema: object;
            annotations: object;
            execute: (input: unknown) => unknown;
          },
          options: { signal: AbortSignal },
        ) => unknown;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  try {
    void Promise.resolve(
      context.registerTool(
        {
          name: 'read_claim_summary',
          title: '讀取目前旅費試算',
          description: '讀取目前畫面的旅費合計、日期欄數與資料檢查結果。',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input) {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).length
            )
              throw new Error('此操作僅接受空物件。');
            const c = getCalculation();
            return {
              totalTwd: c.totalTwd,
              claimTwd: c.claimTwd,
              dayCount: c.dayCount,
              segments: c.groups.length,
              canExport: c.canExport,
              issues: c.issues,
            };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
  } catch {
    /* Browsers without the proposed API keep the visible workflow. */
  }
  return () => controller.abort();
}
