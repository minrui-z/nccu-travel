import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleDraft } from '../lib/claim/claim-engine';
import { normalizeDraftTransition } from '../lib/draft-transitions';
import { requiredDocuments } from '../lib/required-documents';

test('travel date edits require premium limits to be confirmed again without erasing receipts', () => {
  const draft = createSampleDraft();
  const changed = normalizeDraftTransition(draft, {
    ...draft,
    endDate: '2026-07-18',
  });
  assert.equal(changed.insurance.capConfirmed, false);
  assert.equal(changed.insurance.premiumCap, draft.insurance.premiumCap);
  assert.equal(draft.insurance.capConfirmed, true);
  assert.equal(changed.expenses, draft.expenses);
  const privateChange = normalizeDraftTransition(draft, {
    ...draft,
    days: draft.days.map((day, index) =>
      index === 2 ? { ...day, kind: 'personal' } : day,
    ),
  });
  assert.equal(privateChange.insurance.capConfirmed, false);
});

test('a new FX reference day clears bank quotes, while independently dated receipts and card payments remain', () => {
  const draft = createSampleDraft();
  const foreign = draft.expenses.find((e) => e.currency === 'USD')!;
  draft.expenses = [
    foreign,
    { ...foreign, id: 'water-slip', fxSource: 'receipt' },
    { ...foreign, id: 'card', payment: 'card', cardTwd: '500' },
  ];
  const changed = normalizeDraftTransition(draft, {
    ...draft,
    approvedStart: '2026-07-14',
  });
  assert.equal(changed.fx.rate, '');
  assert.equal(changed.expenses[0].fxRate, '');
  assert.equal(changed.expenses[1].fxRate, foreign.fxRate);
  assert.equal(changed.expenses[2].cardTwd, '500');
  const sameReference = normalizeDraftTransition(draft, {
    ...draft,
    approvedStart: '2026-07-12',
  });
  assert.equal(sameReference.fx.rate, draft.fx.rate);
});

test('funding approval flags cannot carry over to a different funding source', () => {
  const draft = createSampleDraft();
  const changed = normalizeDraftTransition(draft, {
    ...draft,
    funding: {
      ...draft.funding!,
      type: 'nstc',
      approvedItems: true,
      sharingApproved: true,
      changeApproved: true,
    },
  });
  assert.equal(changed.funding!.priorApproval, false);
  assert.equal(changed.funding!.approvedItems, false);
  assert.equal(changed.funding!.sharingApproved, false);
  assert.equal(changed.funding!.changeApproved, false);
});

test('inactive flight exceptions do not request hidden supporting documents', () => {
  const draft = createSampleDraft();
  draft.cabin = { standard: false, seniorEligible: true };
  draft.economyClaimOnly = true;
  const withFlags = { ...draft, foreignAirline: true };
  const noFlights = {
    ...withFlags,
    expenses: draft.expenses.filter((e) => e.category !== 'flight'),
  };
  assert.equal(
    requiredDocuments(noFlights).some((d) =>
      ['foreign-airline', 'cabin-appendix', 'economy-proof'].includes(d.id),
    ),
    false,
  );
  const economy = { ...withFlags, cabin: { ...draft.cabin, standard: true } };
  assert.equal(
    requiredDocuments(economy).some((d) => d.id === 'economy-proof'),
    false,
  );
  assert.equal(
    requiredDocuments({ ...withFlags, template: 'student' }).some(
      (d) => d.id === 'cabin-appendix',
    ),
    false,
  );
});
