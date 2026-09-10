import type { Draft } from '@/lib/claim/types';
export interface WorkbenchDraft extends Draft {
  destinationIds?: Record<string, string>;
  checkedDocuments?: Record<string, boolean>;
  insuranceSelection?: { contractId: string; planId: string; days: string };
  foreignAirline?: boolean;
  economyClaimOnly?: boolean;
  airfareExplanation?: string;
}
