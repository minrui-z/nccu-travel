import { useId, useMemo, useState } from 'react';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox';
import type { Allowances } from '@/lib/public-data';
import {
  cityChoices,
  countryChoices,
  locationCatalog,
  matchesLocationSearch,
  type CountryChoice,
  type LocationChoice,
} from '@/lib/location-catalog';

export function DestinationPicker({
  data,
  value,
  onChange,
  label = '留宿地點',
  hint,
  countryLabel,
  cityLabel,
  onCountryChange,
  route = false,
}: {
  data: Allowances | null;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  hint?: string;
  countryLabel?: string;
  cityLabel?: string;
  onCountryChange?: () => void;
  route?: boolean;
}) {
  const id = useId();
  const locations = useMemo(() => locationCatalog(data, route), [data, route]);
  const countries = useMemo(() => countryChoices(locations), [locations]);
  const selectedLocation = locations.find((location) => location.id === value);
  const [chosenCountry, setChosenCountry] = useState(
    selectedLocation?.country ?? '',
  );
  // Existing drafts and asynchronously loaded reference data restore both fields.
  const country = selectedLocation?.country ?? chosenCountry;
  const cities = useMemo(
    () => cityChoices(locations, country),
    [locations, country],
  );
  const countryValue = countries.find((item) => item.id === country) ?? null;
  const description =
    hint ??
    (route
      ? '先選國家，再選城市；未列城市可在下方填寫。'
      : '依留宿城市查詢日支額；未列城市或季節依規定使用該國「其他」。');
  const descriptionId = description ? id + '-hint' : undefined;

  return (
    <div className="destination-picker full" role="group" aria-label={label}>
      <div className="destination-fields">
        <div className="field">
          <label htmlFor={id + '-country'}>
            {countryLabel ?? label + '國家'}
          </label>
          <Combobox
            items={countries}
            value={countryValue}
            disabled={!data}
            onValueChange={(item) => {
              const nextCountry = item?.id ?? '';
              if (nextCountry === country) return;
              setChosenCountry(nextCountry);
              onChange('');
              onCountryChange?.();
            }}
            itemToStringLabel={(item) => item.label}
            isItemEqualToValue={(a, b) => a.id === b.id}
            filter={(item, query) => matchesLocationSearch(item.search, query)}
          >
            <ComboboxInput
              id={id + '-country'}
              placeholder={data ? '選擇或搜尋國家' : '地點資料載入中…'}
              disabled={!data}
              aria-describedby={descriptionId}
            />
            <ComboboxContent>
              <ComboboxEmpty>沒有符合的國家。</ComboboxEmpty>
              <ComboboxList>
                {(item: CountryChoice) => (
                  <ComboboxItem key={item.id} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <div className="field">
          <label htmlFor={id + '-city'}>{cityLabel ?? label + '城市'}</label>
          <Combobox
            // A country change discards the old city's search text and popup state.
            key={country}
            items={cities}
            value={selectedLocation ?? null}
            disabled={!data || !countryValue}
            onValueChange={(item) => {
              setChosenCountry(item?.country ?? country);
              onChange(item?.id ?? '');
            }}
            itemToStringLabel={(item) => item.cityLabel}
            isItemEqualToValue={(a, b) => a.id === b.id}
            filter={(item, query) =>
              matchesLocationSearch(item.cityLabel, query)
            }
          >
            <ComboboxInput
              id={id + '-city'}
              placeholder={countryValue ? '選擇或搜尋城市' : '請先選擇國家'}
              disabled={!data || !countryValue}
              aria-describedby={descriptionId}
            />
            <ComboboxContent>
              <ComboboxEmpty>
                {route
                  ? '沒有符合的城市，可在下方填寫。'
                  : '沒有符合的城市，可選該國「其他」。'}
              </ComboboxEmpty>
              <ComboboxList>
                {(item: LocationChoice) => (
                  <ComboboxItem key={item.id} value={item}>
                    {item.cityLabel}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      </div>
      {description && (
        <p id={descriptionId} className="field-hint">
          {description}
        </p>
      )}
    </div>
  );
}
