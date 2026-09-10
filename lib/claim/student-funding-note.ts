import type { Calculation, Draft } from './types';

/** A suggested disclosure, not an official instruction about form-field placement. */
export function studentFundingNote(
  draft: Draft,
  calculation: Calculation,
): string {
  const { totalTwd, claimTwd } = calculation;
  if (
    draft.template !== 'student' ||
    !/^\d+$/.test(draft.fundingLimit.trim()) ||
    !Number.isSafeInteger(Number(draft.fundingLimit.trim())) ||
    totalTwd === null ||
    claimTwd === null ||
    !Number.isSafeInteger(totalTwd) ||
    !Number.isSafeInteger(claimTwd) ||
    claimTwd < 0 ||
    claimTwd >= totalTwd
  )
    return '';
  const money = (value: number) => value.toLocaleString('en-US');
  const excess = totalTwd - claimTwd;
  const limit = `核定上限NT$${money(Number(draft.fundingLimit.trim()))}`;
  return draft.funding?.shared
    ? `${limit}；差額NT$${money(excess)}不向本案報支，依分攤表辦理。`
    : `${limit}；超額NT$${money(excess)}自行負擔，不向本案報支。`;
}
