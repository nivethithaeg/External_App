/** The latitude and longitude written inside a Google Maps link, if there are any. */
export function coordsFromMapUrl(url: string | null | undefined): { lat: number; lng: number } | null {
  const u = url ?? '';
  const m = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(u)
    ?? /[?&](?:q|query|ll|center|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i.exec(u)
    ?? /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(u);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

/** Only Google's own map hosts are ever opened (a short link is followed to the page it points at; nothing else is fetched). */
export const GOOGLE_MAP_HOST = /^(?:(?:www\.)?google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6}|maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;
export const GOOGLE_MAP_LINK = /^https:\/\/(www\.)?(google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.co\/kgs\/)\S*$/i;

type Fetch = (url: string, init: { redirect: 'manual'; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; url?: string }>;

/**
 * Follows a short Google Maps link (maps.app.goo.gl/…) to the long link it points at and reads the coordinates from it.
 * At most 5 redirects, only to Google hosts, with a time limit.
 */
export async function coordsFromShortLink(link: string, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<{ lat: number; lng: number; url: string } | null> {
  let url = link;
  for (let i = 0; i < 6; i++) {
    const direct = coordsFromMapUrl(url);
    if (direct) return { ...direct, url };
    let host: string;
    try { const u = new URL(url); if (u.protocol !== 'https:') return null; host = u.hostname; } catch { return null; }
    if (!GOOGLE_MAP_HOST.test(host)) return null;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetchImpl(url, { redirect: 'manual', signal: ctl.signal });
      const next = res.headers.get('location');
      if (!next || res.status < 300 || res.status > 399) return null;
      url = new URL(next, url).toString();
    } catch { return null; } finally { clearTimeout(timer); }
  }
  return null;
}
