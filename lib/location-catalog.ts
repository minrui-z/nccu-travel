import type { Allowances } from '@/lib/public-data';

export interface LocationChoice {
  id: string;
  country: string;
  countryEn: string;
  city: string;
  cityEn: string;
  label: string;
  cityLabel: string;
  destinationId: string | null;
  routeOnly: boolean;
}

export interface CountryChoice {
  id: string;
  label: string;
  search: string;
}

// These are itinerary locations only. They carry no allowance or financial data.
const taiwanRouteCities = [
  ['taipei', '臺北', 'Taipei'],
  ['taoyuan', '桃園', 'Taoyuan'],
  ['taichung', '臺中', 'Taichung'],
  ['tainan', '臺南', 'Tainan'],
  ['kaohsiung', '高雄', 'Kaohsiung'],
  ['hualien', '花蓮', 'Hualien'],
  ['taitung', '臺東', 'Taitung'],
  ['penghu', '澎湖', 'Penghu'],
  ['kinmen', '金門', 'Kinmen'],
  ['matsu', '馬祖', 'Matsu'],
] as const;

const countrySearchAliases: Record<string, string> = {
  美國: 'USA US United States United States of America America',
  英國: 'UK United Kingdom Great Britain Britain',
  臺灣: '台灣 Taiwan',
};

export function locationCatalog(
  data: Allowances | null,
  route = false,
): LocationChoice[] {
  const official = (data?.destinations ?? []).map((d) => {
    const city = d.isCountryWide ? '全國' : d.cityZh;
    return {
      id: d.id,
      country: d.countryZh,
      countryEn: d.countryEn,
      city,
      cityEn: d.cityEn,
      label: d.countryZh + '・' + city,
      cityLabel: city + (d.cityEn ? ' ' + d.cityEn : ''),
      destinationId: d.id,
      routeOnly: false,
    };
  });
  if (!route) return official;
  const taiwan = taiwanRouteCities.map(([id, city, cityEn]) => ({
    id: 'route-tw-' + id,
    country: '臺灣',
    countryEn: 'Taiwan',
    city,
    cityEn,
    label: '臺灣・' + city,
    cityLabel: city + ' ' + cityEn,
    destinationId: null,
    routeOnly: true,
  }));
  return [...taiwan, ...official];
}

export function countryChoices(locations: LocationChoice[]): CountryChoice[] {
  const countries = new Map<string, CountryChoice>();
  for (const location of locations) {
    if (!countries.has(location.country)) {
      countries.set(location.country, {
        // Use the exact official country identity, never a partial name match.
        id: location.country,
        label:
          location.country +
          (location.countryEn ? ' ' + location.countryEn : ''),
        search: [
          location.country,
          location.countryEn,
          countrySearchAliases[location.country] ?? '',
        ].join(' '),
      });
    }
  }
  return [...countries.values()];
}

export function cityChoices(locations: LocationChoice[], country: string) {
  return locations.filter((location) => location.country === country);
}

export function matchesLocationSearch(text: string, query: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replaceAll('台', '臺')
      .replace(/[\s.・·,()（）-]+/g, '');
  const normalizedText = normalize(text);
  return query
    .trim()
    .split(/\s+/)
    .every((word) => normalizedText.includes(normalize(word)));
}

export function getLocation(
  data: Allowances | null,
  id: string,
  route = false,
): LocationChoice | null {
  return (
    locationCatalog(data, route).find((location) => location.id === id) ?? null
  );
}
