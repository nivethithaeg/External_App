import { useState } from 'react';
import { Input, Select } from './ui';
import { STATES, citiesOf } from '../lib/india';

const OTHER = '__other__';

/** State first; the City list then shows only that state's cities. "Other" lets someone type a city that isn't listed. */
export function StateCityFields({ state, city, onChange, errors = {}, mandatory = true, dataFieldPrefix = '', locked = false }: {
  state: string; city: string; onChange(v: { state: string; city: string }): void; errors?: { state?: string; city?: string }; mandatory?: boolean; dataFieldPrefix?: string; /** shown, but cannot be changed here */ locked?: boolean;
}) {
  const cities = citiesOf(state);
  // A saved city that isn't in the list (or typed earlier) keeps the free-text box open.
  const [other, setOther] = useState(() => !!city && !!state && !citiesOf(state).includes(city));
  const selectValue = other ? OTHER : city;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select data-field={`${dataFieldPrefix}state`} label="State" mandatory={mandatory} value={state} error={errors.state} disabled={locked}
        onChange={(e) => { setOther(false); onChange({ state: e.target.value, city: '' }); }}>
        <option value="">Select state</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <Select data-field={`${dataFieldPrefix}city`} label="City" mandatory={mandatory} value={selectValue} error={errors.city} disabled={!state || locked}
        onChange={(e) => { if (e.target.value === OTHER) { setOther(true); onChange({ state, city: '' }); } else { setOther(false); onChange({ state, city: e.target.value }); } }}>
        <option value="">{state ? 'Select city' : 'Select a state first'}</option>
        {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        {state && <option value={OTHER}>Other (not listed)</option>}
      </Select>
      {other && state && <div className="sm:col-span-2"><Input data-field={`${dataFieldPrefix}cityOther`} label="Your city" mandatory={mandatory} value={city} onChange={(e) => onChange({ state, city: e.target.value })} error={errors.city} maxLength={80} readOnly={locked} /></div>}
    </div>
  );
}
