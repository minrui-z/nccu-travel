import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSampleDraft, calculateClaim } from '../lib/claim/claim-engine';
import {
  applyDailyDestination,
  editTransitEndpoint,
  transitForDay,
  copyDutyDestination,
  routePlaceLabel,
} from '../lib/trip-locations';
import { isDraft } from '../lib/draft-schema';
import type { Allowances } from '../lib/public-data';
const data = JSON.parse(
  readFileSync(
    new URL('../public/data/allowances-2026.json', import.meta.url),
    'utf8',
  ),
) as Allowances;
const boston = data.destinations.find(
  (d) => d.countryZh === '美國' && d.cityEn.startsWith('Boston'),
)!;

test('flight endpoint edits preserve the other endpoint, allowance and legacy route until edited', () => {
  const day = createSampleDraft().days[0];
  const before = structuredClone(day);
  assert.deepEqual(transitForDay(day), { from: '臺北', to: '美國舊金山' });
  const changed = editTransitEndpoint(day, 'to', '美國・波士頓', boston.id);
  assert.equal(changed.location, '臺北→美國・波士頓');
  assert.equal(changed.transit?.from, '臺北');
  assert.equal(changed.usdRate, day.usdRate);
  assert.deepEqual(day, before);
  assert.deepEqual(transitForDay({ ...day, location: '美國・波士頓' }), {
    from: '',
    to: '',
  });
});
test('country changes clear an allowance but never overwrite a flight route', () => {
  const day = editTransitEndpoint(
    createSampleDraft().days[0],
    'to',
    '美國・波士頓',
    boston.id,
  );
  const selected = applyDailyDestination(day, data, boston.id);
  assert.equal(selected.location, day.location);
  assert.deepEqual(selected.transit, day.transit);
  assert.equal(selected.usdRate, '395');
  const cleared = applyDailyDestination(selected, data, '');
  assert.equal(cleared.usdRate, '');
  assert.equal(cleared.location, day.location);
  assert.throws(() => applyDailyDestination(day, data, 'route-tw-taipei'));
});
test('ordinary lodging selection sets a country and city; bulk updates preserve flight and return entries', () => {
  const draft = createSampleDraft();
  const source = applyDailyDestination(draft.days[1], data, boston.id);
  assert.equal(source.location, '美國・波士頓');
  assert.equal(applyDailyDestination(source, data, '').location, '');
  assert.equal(
    copyDutyDestination(source, draft.days[0], data, boston.id),
    draft.days[0],
  );
  assert.equal(
    copyDutyDestination(source, draft.days.at(-1)!, data, boston.id),
    draft.days.at(-1),
  );
  assert.equal(
    copyDutyDestination(source, draft.days[2], data, boston.id).location,
    '美國・波士頓',
  );
});
test('saved route shape is checked, complete routes export and partial routes cannot export', () => {
  const draft = createSampleDraft();
  draft.days[0] = editTransitEndpoint(
    draft.days[0],
    'to',
    '美國・波士頓',
    boston.id,
  );
  assert.equal(isDraft(JSON.parse(JSON.stringify(draft))), true);
  assert.equal(calculateClaim(draft).groups[0].location, '臺北→美國・波士頓');
  draft.days[0] = editTransitEndpoint(draft.days[0], 'from', '');
  assert.ok(
    calculateClaim(draft).issues.some((i) => i.path === 'days.0.transit.from'),
  );
  for (const bad of [
    null,
    {},
    { from: 4, to: '臺北' },
    { from: '臺北', to: '美國', fromId: 1 },
  ]) {
    const malformed = JSON.parse(JSON.stringify(draft));
    malformed.days[0].transit = bad;
    assert.equal(isDraft(malformed), false);
  }
});

test('generated route names retain foreign country and city, using the original form domestic-city convention', () => {
  assert.equal(routePlaceLabel({country:'臺灣',city:'臺北'}),'臺北');
  assert.equal(routePlaceLabel({country:'美國',city:'波士頓'}),'美國波士頓');
});
test('a legacy overnight entry containing only one city remains editable but requires both endpoints before export', () => {
  const draft=createSampleDraft();
  draft.days[0].location='美國・波士頓';
  assert.equal(isDraft(draft),true);
  const result=calculateClaim(draft);
  assert.equal(result.canExport,false);
  assert.ok(result.issues.some(i=>i.code==='transit-endpoints'));
  assert.equal(draft.days[0].location,'美國・波士頓');
});
