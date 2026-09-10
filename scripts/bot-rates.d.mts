export interface ImportedRates {
  quotationDate: string;
  sourceMethod: string;
  dateProofConfirmed: boolean;
  currencyRates: Record<
    string,
    {
      cashSelling: string | null;
      spotSelling: string | null;
      cashBuying: string | null;
      spotBuying: string | null;
    }
  >;
}
export function parseBotCsvImport(
  text: string,
  options?: {
    filename?: string;
    targetDate?: string;
    dateProofConfirmed?: boolean;
    minCurrencies?: number;
  },
): ImportedRates;
