import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Allowances } from '@/lib/public-data';
import {
  cityChoices,
  countryChoices,
  getLocation,
  locationCatalog,
  matchesLocationSearch,
} from '../lib/location-catalog';

const data = JSON.parse(
  readFileSync(
    new URL('../public/data/allowances-2026.json', import.meta.url),
    'utf8',
  ),
) as Allowances;

test('country identity and city filtering are exact, with no other countries leaking into a selection', () => {
  const catalog = locationCatalog(data);
  const countries = countryChoices(catalog);
  assert.equal(
    countries.length,
    new Set(data.destinations.map((d) => d.countryZh)).size,
  );
  const us = cityChoices(catalog, '美國');
  assert.equal(
    us.length,
    data.destinations.filter((d) => d.countryZh === '美國').length,
  );
  assert.ok(us.length > 1);
  assert.ok(us.every((city) => city.country === '美國'));
  assert.ok(us.some((city) => city.city === '波士頓'));
  assert.ok(!us.some((city) => city.city === '東京'));
  assert.deepEqual(cityChoices(catalog, ''), []);
  assert.deepEqual(cityChoices(catalog, '美'), []);
});

test('search accepts Chinese, English, punctuation-free abbreviations, and multi-word cities', () => {
  const us = countryChoices(locationCatalog(data)).find(
    (country) => country.id === '美國',
  )!;
  assert.ok(matchesLocationSearch(us.search, '美國'));
  assert.ok(matchesLocationSearch(us.search, 'u.s.a.'));
  assert.ok(matchesLocationSearch(us.search, 'United States'));
  const boston = cityChoices(locationCatalog(data), '美國').find(
    (city) => city.city === '波士頓',
  )!;
  assert.ok(matchesLocationSearch(boston.cityLabel, '波士'));
  assert.ok(matchesLocationSearch(boston.cityLabel, 'BOSTON'));
  const sanFrancisco = cityChoices(locationCatalog(data), '美國').find(
    (city) => city.city === '舊金山',
  )!;
  assert.ok(matchesLocationSearch(sanFrancisco.cityLabel, 'San Francisco'));
  assert.ok(!matchesLocationSearch(boston.cityLabel, 'Tokyo'));
  assert.ok(matchesLocationSearch('臺灣 Taiwan', '台灣'));
});

test('existing destination IDs resolve country, city, and the original allowance ID', () => {
  const source = data.destinations.find((d) => d.cityZh === '波士頓')!;
  const location = getLocation(data, source.id)!;
  assert.equal(location.country, '美國');
  assert.equal(location.city, '波士頓');
  assert.equal(location.label, '美國・波士頓');
  assert.equal(location.destinationId, source.id);
  assert.equal(location.routeOnly, false);
  assert.equal(getLocation(data, 'not-a-destination'), null);
});

test('Taiwan route endpoints have no allowance IDs or rates and never enter the allowance catalog', () => {
  const before = JSON.stringify(data);
  const normal = locationCatalog(data);
  const routes = locationCatalog(data, true);
  const taiwan = cityChoices(routes, '臺灣');
  assert.equal(taiwan.length, 10);
  assert.deepEqual(
    taiwan.map((location) => location.city),
    [
      '臺北',
      '桃園',
      '臺中',
      '臺南',
      '高雄',
      '花蓮',
      '臺東',
      '澎湖',
      '金門',
      '馬祖',
    ],
  );
  assert.ok(
    taiwan.every(
      (location) => location.destinationId === null && location.routeOnly,
    ),
  );
  assert.ok(taiwan.every((location) => !('rates' in location)));
  assert.equal(routes.length, normal.length + 10);
  assert.ok(normal.every((location) => !location.id.startsWith('route-tw-')));
  assert.equal(getLocation(data, 'route-tw-taoyuan'), null);
  assert.equal(
    getLocation(data, 'route-tw-taoyuan', true)?.label,
    '臺灣・桃園',
  );
  assert.equal(JSON.stringify(data), before);
});
