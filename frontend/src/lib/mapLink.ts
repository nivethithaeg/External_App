/** The latitude and longitude written inside a Google Maps link (the same reading JusGo does), or null. */
export function coordsFromMapUrl(url: string | null | undefined): { lat: number; lng: number } | null {
  const u = url ?? '';
  const m = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(u)
    ?? /[?&](?:q|query|ll|center|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i.exec(u)
    ?? /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(u);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}
/** A link copied from Google Maps (Share > Copy link). */
export const GOOGLE_MAPS_LINK = /^https:\/\/((www\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.co\/kgs\/)\S*$/i;
