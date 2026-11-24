export interface Gps { lat: number; lng: number }

/** Distance in metres between two points on the Earth (haversine). */
export function distanceMeters(a: Gps, b: Gps): number {
  const rad = (d: number) => (d * Math.PI) / 180; const R = 6371000;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
