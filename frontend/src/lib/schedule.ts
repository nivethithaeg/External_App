/** Opening hours and per-slot prices of a playing area, converted between the saved rules and the grid the owner edits. */
export interface Rule { sportId: number | null; dayType: 'all' | 'weekday' | 'weekend'; dayOfWeek: number | null; startTime: string; endTime: string; pricePerHour: number }
export interface Day { dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }
/** 'all' = the price for every sport; a number = a price for just that sport (blank there means "same as all sports"). */
export type Scope = 'all' | number;
/** scope -> day of week -> slot start (minutes since midnight) -> price of that slot in rupees. A missing entry means no price. */
export type Prices = Record<string, Record<number, Record<number, number>>>;

/** The default price: one rule for every sport, every day and the whole day (00:00 to 24:00). */
export const isDefaultRule = (r: Rule) => r.sportId == null && r.dayType === 'all' && r.dayOfWeek == null && r.startTime.slice(0, 5) === '00:00' && r.endTime.slice(0, 5) === '24:00';
export const defaultRule = (rules: Rule[]) => rules.find((r) => isDefaultRule(r) && Number(r.pricePerHour) > 0);
export const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fmtSlot = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${(m / 60) % 24 >= 12 ? 'PM' : 'AM'}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Start of every whole slot between opening and closing time. A closed day has none. */
export function slotStarts(d: Day, step: number): number[] {
  if (d.isClosed) return [];
  const out: number[] = []; const close = toMin(d.closeTime);
  for (let m = toMin(d.openTime); m + step <= close; m += step) out.push(m);
  return out;
}

/** The hourly rate a rule set gives one slot, looking only at the rules of one scope. The most specific rule wins: one weekday, then weekday/weekend, then every day. */
export function rateFor(rules: Rule[], scope: Scope, dow: number, minute: number): number | null {
  const dayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
  const hits = rules.filter((r) => Number(r.pricePerHour) > 0 && !isDefaultRule(r) && (scope === 'all' ? r.sportId === null : r.sportId === scope) && (r.dayOfWeek == null || r.dayOfWeek === dow)
    && (r.dayType === 'all' || r.dayType === dayType) && toMin(r.startTime) <= minute && minute < toMin(r.endTime));
  if (!hits.length) return null;
  const score = (r: Rule) => (r.dayOfWeek != null ? 2 : 0) + (r.dayType !== 'all' ? 1 : 0);
  return [...hits].sort((a, b) => score(b) - score(a))[0].pricePerHour;
}

/** The grid of slot prices for the saved rules: what each slot costs per day and per scope. */
export function buildPrices(rules: Rule[], days: Day[], scopes: Scope[], step: number): Prices {
  const out: Prices = {};
  for (const sc of scopes) {
    const byDay: Record<number, Record<number, number>> = {};
    for (const d of days) {
      const row: Record<number, number> = {};
      for (const m of slotStarts(d, step)) { const rate = rateFor(rules, sc, d.dayOfWeek, m); if (rate !== null) row[m] = round2((Number(rate) * step) / 60); }
      byDay[d.dayOfWeek] = row;
    }
    out[String(sc)] = byDay;
  }
  return out;
}

/** The rules to save: neighbouring slots with the same price are joined into one rule, so a day of equal prices is a single rule. */
export function toRules(prices: Prices, days: Day[], step: number): Rule[] {
  const out: Rule[] = [];
  for (const [key, byDay] of Object.entries(prices)) {
    const sportId = key === 'all' ? null : Number(key);
    for (const d of days) {
      const row = byDay[d.dayOfWeek] ?? {}; let start: number | null = null; let price = 0; let prev = 0;
      const flush = () => { if (start !== null) out.push({ sportId, dayType: 'all', dayOfWeek: d.dayOfWeek, startTime: toHHMM(start), endTime: toHHMM(prev + step), pricePerHour: round2((price * 60) / step) }); start = null; };
      for (const m of slotStarts(d, step)) {
        const p = row[m];
        if (p === undefined || !(p > 0)) { flush(); continue; } // an empty or ₹0 slot has no price: it is not saved, so it cannot be booked
        if (start !== null && p === price && m === prev + step) { prev = m; continue; }
        flush(); start = m; price = p; prev = m;
      }
      flush();
    }
  }
  return out;
}

/** Slots that are open but have no price in the all-sports prices: customers cannot book these. */
export function unpricedCount(prices: Prices, days: Day[], step: number, hasDefault = false): number {
  if (hasDefault) return 0; // a slot without its own price uses the default price
  return days.reduce((n, d) => n + slotStarts(d, step).filter((m) => prices.all?.[d.dayOfWeek]?.[m] === undefined).length, 0);
}
