import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';

export interface KnownPerson { name: string; city: string }

/** The 10 digits of an Indian mobile as typed (+91 / 0 in front dropped); '' until all 10 are there. */
export const mobileDigits = (m: string) => {
  let d = m.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
};

/** The people the owner already has (the Customers page), by mobile. A staff login without access simply gets no matches. */
export function useKnownPeople(): Map<string, KnownPerson> {
  const q = useQuery({ queryKey: ['owner-customers-known'], queryFn: () => get<{ customers: any[] }>('/owner/customers'), retry: false, staleTime: 60_000 });
  return useMemo(() => {
    const m = new Map<string, KnownPerson>();
    for (const c of q.data?.customers ?? []) { const d = mobileDigits(String(c.mobile ?? '')); if (d && c.name) m.set(d, { name: c.name, city: c.city ?? '' }); }
    return m;
  }, [q.data]);
}

/** Under a mobile field: "This number is already saved as Meera Iyer. Use the same name, or enter a new name?" */
export function KnownMobilePrompt({ mobile, name, nameId, people, onUse }: { mobile: string; name: string; nameId: string; people: Map<string, KnownPerson>; onUse: (p: KnownPerson) => void }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const digits = mobileDigits(mobile); const known = digits ? people.get(digits) : undefined;
  if (!known || dismissed === digits || name.trim().toLowerCase().replace(/\s+/g, ' ') === known.name.toLowerCase()) return null;
  return (
    <div role="status" className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1">This number is already saved as <b>{known.name}</b>{known.city ? ` (${known.city})` : ''}. Use the same name, or enter a new name?</span>
      <span className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary !py-1.5" onClick={() => onUse(known)}>Use {known.name}</button>
        <button type="button" className="btn-ghost !py-1.5" onClick={() => { setDismissed(digits); document.getElementById(nameId)?.focus(); }}>Enter a new name</button>
      </span>
    </div>);
}
