import type { Config } from '../config.js';
import type { Gps } from './geo.js';

/**
 * The street address for a position (reverse geocoding), from an OpenStreetMap Nominatim-compatible service. Only the position is sent.
 * The address is a convenience for the owner and the admin, so any failure returns null and never stops a photo from being saved.
 * Set GEOCODE_URL to another compatible service, or leave it empty to turn lookups off.
 */
export async function reverseGeocode(cfg: Pick<Config, 'GEOCODE_URL'>, at: Gps): Promise<string | null> {
  if (!cfg.GEOCODE_URL) return null;
  try {
    const url = `${cfg.GEOCODE_URL}${cfg.GEOCODE_URL.includes('?') ? '&' : '?'}format=jsonv2&zoom=18&lat=${encodeURIComponent(at.lat)}&lon=${encodeURIComponent(at.lng)}`;
    const res = await fetch(url, { headers: { 'user-agent': 'PlaynX/1.0 turf-booking', accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const a = typeof j?.display_name === 'string' ? j.display_name.trim() : '';
    return a ? a.slice(0, 300) : null;
  } catch { return null; }
}
