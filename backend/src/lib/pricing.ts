export interface PriceRule {
  sport_id: number | null; day_type: 'all' | 'weekday' | 'weekend'; day_of_week?: number | null;
  start_time: string; end_time: string; price_per_hour: number;
  /** a price set for one chosen date (pricing_date_slots) outranks every weekly rule */
  priority?: number;
}
export const toMin = (t: string) => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m); };
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Most specific matching rule wins: sport-specific beats generic, then one particular weekday, then weekday/weekend, then 'all'. */
export function rateAt(rules: PriceRule[], dow: number, sportId: number, minute: number): number | null {
  const dayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
  const hits = rules.filter((r) =>
    (r.sport_id === null || r.sport_id === sportId) && (r.day_of_week == null || r.day_of_week === dow) && (r.day_type === 'all' || r.day_type === dayType) &&
    toMin(r.start_time) <= minute && minute < toMin(r.end_time));
  if (!hits.length) return null;
  const score = (r: PriceRule) => (r.priority ?? 0) * 100 + (r.sport_id !== null ? 4 : 0) + (r.day_of_week != null ? 2 : 0) + (r.day_type !== 'all' ? 1 : 0);
  hits.sort((a, b) => score(b) - score(a));
  return hits[0].price_per_hour;
}

/** Total price for [startMin, startMin+durationMin) priced step-by-step so peak/off-peak hours blend correctly. null = not priced. */
export function priceFor(rules: PriceRule[], dow: number, sportId: number, startMin: number, durationMin: number, stepMin: number): number | null {
  let total = 0;
  for (let m = startMin; m < startMin + durationMin; m += stepMin) {
    const r = rateAt(rules, dow, sportId, m);
    if (r === null) return null;
    total += (r * stepMin) / 60;
  }
  return round2(total);
}
