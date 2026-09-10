import { civilDay } from './claim/claim-engine';
import { fetchJson } from './paths';
export interface PublicSource {
  id: string;
  title: string;
  url: string;
  localPath?: string;
  sha256: string;
  retrievedAt: string;
}
export interface Destination {
  id: string;
  countryZh: string;
  countryEn: string;
  cityZh: string;
  cityEn: string;
  officialLabel: string;
  isCountryOther: boolean;
  isCountryWide: boolean;
  countryOtherId: string | null;
  sourceId: string;
  sourcePage: number;
  rates: Array<{
    amountUsd: string;
    season: { fromMMDD: string; toMMDD: string } | null;
  }>;
}
export interface Allowances {
  schemaVersion: number;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sources: PublicSource[];
  destinations: Destination[];
}
export interface InsurancePlan {
  id: string;
  officialLabel: string;
  planType: string;
  minAge: number;
  maxAgeExclusive: number | null;
  statedCoverageNtd: string | null;
  sourcePage: number;
  premiumsNtdByDays: Record<string, string>;
}
export interface InsuranceData {
  schemaVersion: number;
  sources: PublicSource[];
  contracts: Array<{
    id: string;
    effectiveFrom: string;
    effectiveTo: string;
    sourceId: string;
    plans: InsurancePlan[];
  }>;
}
export interface FxIndex {
  earliestQuotationDate: string | null;
  latestQuotationDate: string | null;
  availableDates: string[];
  currencies?: string[];
  quotationCount?: number;
}
export interface FxSnapshot {
  schemaVersion: number;
  quotationDate: string;
  sourceUrl: string;
  retrievedAt: string;
  currencyRates: Record<
    string,
    { cashSelling: string | null; spotSelling: string | null }
  >;
}
export function destinationLabel(d: Destination): string {
  return (
    d.countryZh +
    '・' +
    (d.isCountryWide ? '全國' : d.cityZh) +
    (d.cityEn ? ' ' + d.cityEn : '')
  );
}
export function allowanceFor(
  data: Allowances,
  id: string,
  date: string,
): {
  amount: string;
  source: PublicSource | undefined;
  page: number;
  fallback: boolean;
  label: string;
} | null {
  if (
    civilDay(date) === null ||
    date < data.effectiveFrom ||
    (data.effectiveTo && date > data.effectiveTo)
  )
    return null;
  const destination = data.destinations.find((x) => x.id === id);
  if (!destination) return null;
  const mmdd = date.slice(5);
  const select = (d: Destination) =>
    d.rates.find(
      (r) =>
        !r.season ||
        (r.season.fromMMDD <= r.season.toMMDD
          ? mmdd >= r.season.fromMMDD && mmdd <= r.season.toMMDD
          : mmdd >= r.season.fromMMDD || mmdd <= r.season.toMMDD),
    );
  let actual = destination;
  let rate = select(destination);
  if (!rate && destination.countryOtherId) {
    const other = data.destinations.find(
      (x) => x.id === destination.countryOtherId,
    );
    if (other) {
      actual = other;
      rate = select(other);
    }
  }
  if (!rate) return null;
  return {
    amount: rate.amountUsd,
    source: data.sources.find((x) => x.id === actual.sourceId),
    page: actual.sourcePage,
    fallback: actual.id !== destination.id,
    label: destinationLabel(actual),
  };
}
export async function loadAllowances() {
  const data = await fetchJson<Allowances>('data/allowances-2026.json');
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.destinations) ||
    !data.destinations.length
  )
    throw new Error('日支數額資料版本不支援。');
  return data;
}
export async function loadInsurance() {
  const data = await fetchJson<InsuranceData>('data/insurance-premiums.json');
  if (data.schemaVersion !== 1 || !Array.isArray(data.contracts))
    throw new Error('保費資料版本不支援。');
  return data;
}
export async function exactSnapshot(date: string): Promise<FxSnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('請先填寫匯率基準出發日。');
  const data = await fetchJson<FxSnapshot>('data/fx/' + date + '.json');
  if (
    data.schemaVersion !== 1 ||
    data.quotationDate !== date ||
    !data.currencyRates
  )
    throw new Error('匯率資料日期不符，請使用官方資料核對。');
  return data;
}
