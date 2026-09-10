import type { DailyEntry } from './claim/types';
import { allowanceFor, type Allowances } from './public-data';

export const hasTravelRoute = (day: DailyEntry) =>
  day.kind === 'flight' || day.kind === 'return';

/** Printed routes follow the supplied form's 臺北→美國舊金山 convention. */
export function routePlaceLabel(place: {
  country: string;
  city: string;
}): string {
  return place.country === '臺灣' ? place.city : place.country + place.city;
}

/** Legacy route text remains intact until an endpoint is explicitly edited. */
export function transitForDay(
  day: DailyEntry,
): NonNullable<DailyEntry['transit']> {
  if (day.transit) return day.transit;
  const parts = day.location.split(/\s*(?:→|－|—|->)\s*/);
  return parts.length === 2 && parts.every((part) => part.trim())
    ? { from: parts[0].trim(), to: parts[1].trim() }
    : { from: '', to: '' };
}

export function editTransitEndpoint(
  day: DailyEntry,
  side: 'from' | 'to',
  text: string,
  id = '',
): DailyEntry {
  const transit = {
    ...transitForDay(day),
    [side]: text,
    [side === 'from' ? 'fromId' : 'toId']: id,
  };
  return {
    ...day,
    transit,
    location: `${transit.from.trim()}→${transit.to.trim()}`,
  };
}

/** Private travel retains its optional location; daily claim fields stay empty. */
export function clearPrivateDay(day: DailyEntry): DailyEntry {
  return {
    ...day,
    kind: 'personal',
    work: '個人行程',
    usdRate: '',
    transit: undefined,
    rateSource: undefined,
    usdRateProof: undefined,
    lodgingProvided: false,
    breakfast: false,
    lunch: false,
    dinner: false,
    mealsInFlight: false,
    weekendOfficial: false,
    extraDeductionUsd: '',
  };
}

export function changeDayKind(
  day: DailyEntry,
  kind: DailyEntry['kind'],
  route = transitForDay(day),
): DailyEntry {
  if (kind === 'personal') return clearPrivateDay(day);
  const base =
    day.kind === 'personal' ? { ...clearPrivateDay(day), work: '' } : day;
  if (kind === 'flight' || kind === 'return') {
    const endpoints = day.kind === 'personal' ? { from: '', to: '' } : route;
    return {
      ...base,
      kind,
      lodgingProvided: false,
      transit: { ...endpoints },
      location: `${endpoints.from.trim()}→${endpoints.to.trim()}`,
    };
  }
  return {
    ...base,
    kind,
    transit: undefined,
    location: hasTravelRoute(day) ? '' : base.location,
    // Legacy flight meals were exempt, not supplied conference meals. They
    // must not become deductions when changing the day back to ordinary duty.
    ...(base.mealsInFlight
      ? { breakfast: false, lunch: false, dinner: false, mealsInFlight: false }
      : {}),
  };
}

/** The visible meal controls describe deductible meals, never flight meals. */
export function setProvidedMeal(
  day: DailyEntry,
  meal: 'breakfast' | 'lunch' | 'dinner',
  provided: boolean,
): DailyEntry {
  if (day.kind === 'personal') return clearPrivateDay(day);
  return {
    ...day,
    ...(day.mealsInFlight
      ? { breakfast: false, lunch: false, dinner: false }
      : {}),
    mealsInFlight: false,
    [meal]: provided,
  };
}

export function normalizePrivateDays<
  T extends { days: DailyEntry[]; destinationIds?: Record<string, string> },
>(draft: T): T {
  const privateIds = new Set(
    draft.days.filter((day) => day.kind === 'personal').map((day) => day.id),
  );
  if (!privateIds.size) return draft;
  return {
    ...draft,
    days: draft.days.map((day) =>
      privateIds.has(day.id) ? clearPrivateDay(day) : day,
    ),
    ...(draft.destinationIds
      ? {
          destinationIds: Object.fromEntries(
            Object.entries(draft.destinationIds).filter(
              ([id]) => !privateIds.has(id),
            ),
          ),
        }
      : {}),
  };
}

/** Allowance lookup and the printed route are independent. */
export function applyDailyDestination(
  day: DailyEntry,
  data: Allowances,
  id: string,
): DailyEntry {
  if (day.kind === 'personal') return clearPrivateDay(day);
  if (!id)
    return {
      ...day,
      location: hasTravelRoute(day) ? day.location : '',
      transit: hasTravelRoute(day) ? day.transit : undefined,
      usdRate: '',
      rateSource: 'official',
      usdRateProof: '',
    };
  const destination = data.destinations.find((item) => item.id === id);
  const rate = allowanceFor(data, id, day.date);
  if (!destination || !rate)
    throw new Error('此日期沒有適用的官方日支數額，請核對資料生效日期。');
  return {
    ...day,
    location: hasTravelRoute(day)
      ? day.location
      : `${destination.countryZh}・${destination.isCountryWide ? '全國' : destination.cityZh}`,
    transit: hasTravelRoute(day) ? day.transit : undefined,
    usdRate: rate.amount,
    rateSource: 'official',
    usdRateProof: `${rate.source?.url ?? ''}#page=${rate.page}`,
  };
}

/** Bulk location edits apply to ordinary duty days, never to a separately entered route. */
export function copyDutyDestination(
  source: DailyEntry,
  target: DailyEntry,
  data: Allowances | null,
  id: string,
): DailyEntry {
  if (target.kind !== 'official') return target;
  if (id && !data)
    throw new Error('官方日支額資料尚未載入，請稍後再套用地點。');
  const updated =
    id && data
      ? applyDailyDestination(target, data, id)
      : {
          ...target,
          location: source.location,
          usdRate: source.usdRate,
          rateSource: source.rateSource,
          usdRateProof: source.usdRateProof,
        };
  return { ...updated, transit: undefined, work: source.work };
}
