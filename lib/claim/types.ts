export type Template = 'general' | 'student';
export type Category =
  | 'flight'
  | 'ship'
  | 'land'
  | 'handling'
  | 'insurance'
  | 'registration'
  | 'misc';
export type FxSource =
  | 'bot-cash'
  | 'bot-spot'
  | 'receipt'
  | 'card'
  | 'central-bank'
  | 'manual';
export type ManualFxBasis = 'bank' | 'receipt';
export type FxProvenance = 'automatic' | 'manual' | 'imported';
export interface DailyEntry {
  id: string;
  date: string;
  location: string;
  transit?: { from: string; to: string; fromId?: string; toId?: string };
  work: string;
  usdRate: string;
  kind: 'official' | 'return' | 'flight' | 'personal';
  rateSource?: 'official' | 'manual';
  usdRateProof?: string;
  lodgingProvided: boolean;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  mealsInFlight: boolean;
  weekendOfficial: boolean;
  extraDeductionUsd: string;
}
export interface Expense {
  id: string;
  date: string;
  category: Category;
  administrativeType?: 'registration' | 'other';
  description: string;
  amount: string;
  currency: string;
  fxRate: string;
  payment: 'cash' | 'card';
  cardTwd: string;
  cardFeeTwd: string;
  receipt: string;
  foreignTaxi: boolean;
  fxDate?: string;
  fxSource?: FxSource;
  fxProofNote?: string;
  fxProvenance?: FxProvenance;
  manualBasis?: ManualFxBasis;
  cashUnavailable?: boolean;
  botUnavailable?: boolean;
}
export interface DateGroup {
  id: string;
  dayIds: string[];
}
export interface Draft {
  version: 1;
  template: Template;
  person: { name: string; identifier: string; title: string; grade: string };
  purpose: string;
  budgetItem: string;
  voucherNumber: string;
  approvedStart: string;
  approvedEnd?: string;
  dischargeDate?: string;
  startDate: string;
  endDate: string;
  receiptCount: string;
  fundingLimit: string;
  fx: {
    rate: string;
    rateDate: string;
    source: 'bot' | 'receipt' | 'card' | 'manual';
    proofNote: string;
    manualBasis?: ManualFxBasis;
    provenance?: FxProvenance;
  };
  days: DailyEntry[];
  expenses: Expense[];
  groups: DateGroup[];
  notes: string;
  insurance: {
    coverageAmount: string;
    premiumCap: string;
    capConfirmed: boolean;
  };
  cabin: { standard: boolean; seniorEligible: boolean };
  economyClaimOnly?: boolean;
  airfareExplanation?: string;
  checkedDocuments?: Record<string, boolean>;
  funding?: {
    type: 'nstc' | 'other';
    activityRole: 'paper' | 'speaker' | 'chair' | 'approved' | 'other';
    priorApproval: boolean;
    approvedItems: boolean;
    shared: boolean;
    sharingApproved: boolean;
    planChanged: boolean;
    changeApproved: boolean;
  };
}
export interface Issue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  path: string;
  message: string;
}
export interface DailyCalculation {
  id: string;
  date: string;
  eligible: boolean;
  percent: number;
  grossUsd: string | null;
  deductionUsd: string | null;
  netUsd: string | null;
  exactTwd: string | null;
  formula: string;
  reason: string;
}
export interface ExpenseCalculation {
  id: string;
  category: Category;
  exactTwd: string | null;
  formula: string;
}
export interface CategoryCalculation {
  category: Category | 'living';
  label: string;
  exactTwd: string | null;
  twd: number | null;
}
export interface GroupCalculation {
  id: string;
  dayIds: string[];
  startDate: string;
  endDate: string;
  monthLabel: string;
  dayLabel: string;
  dateLabel: string;
  location: string;
  work: string;
  grossUsd: string | null;
  netUsd: string | null;
  deductionUsd: string | null;
  livingText: string;
  deductionText: string;
  expenses: Partial<Record<Category, string>>;
  receipts: string;
}
export interface Calculation {
  daily: DailyCalculation[];
  expenses: ExpenseCalculation[];
  groups: GroupCalculation[];
  categories: CategoryCalculation[];
  totalTwd: number | null;
  claimTwd: number | null;
  receiptCount: number | null;
  dayCount: number;
  fxReferenceDate: string | null;
  issues: Issue[];
  canExport: boolean;
  rounding: 'category-half-up';
}
