/** Venues this customer looked at recently. Kept in the browser only: it is a convenience, not an account record. */
export interface RecentVenue { id: string; name: string; city: string; cover: string | null }
const KEY = 'playnx_recent_venues';

export function recentVenues(): RecentVenue[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.slice(0, 4) : []; } catch { return []; }
}
export function rememberVenue(v: RecentVenue) {
  try { localStorage.setItem(KEY, JSON.stringify([v, ...recentVenues().filter((x) => x.id !== v.id)].slice(0, 8))); } catch { /* storage unavailable */ }
}
