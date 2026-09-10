/** Presentation behavior uses field identity, never translated labels. */
export function fieldInputMode(path?: string): 'numeric' | 'decimal' | undefined {
  if (!path) return undefined;
  if (path === 'receiptCount') return 'numeric';
  if (path === 'fundingLimit' || /^(fx\.rate|insurance\.(coverageAmount|premiumCap))$/.test(path)
    || /^days\.\d+\.(usdRate|extraDeductionUsd)$/.test(path)
    || /^expenses\.\d+\.(amount|fxRate|cardTwd|cardFeeTwd)$/.test(path)) return 'decimal';
  return undefined;
}
export function fieldRequirement(path?: string): 'required' | 'optional' | undefined {
  if (!path) return undefined;
  if (['person.name', 'person.identifier', 'person.title', 'purpose', 'startDate', 'endDate', 'fx.rate', 'fx.rateDate'].includes(path)) return 'required';
  if (['person.grade', 'voucherNumber', 'budgetItem', 'fundingLimit', 'notes', 'receiptCount', 'dischargeDate'].includes(path)
    || /^expenses\.\d+\.(receipt|cardFeeTwd|description)$/.test(path)) return 'optional';
  if (/^expenses\.\d+\.(date|category|amount|fxRate|cardTwd|fxDate)$/.test(path)
    || /^days\.\d+\.(usdRate|location|work|transit\.(from|to))$/.test(path)) return 'required';
  return undefined;
}
