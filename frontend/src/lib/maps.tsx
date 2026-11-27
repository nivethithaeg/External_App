import { useEffect, useRef, useState } from 'react';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
export const mapsEnabled = !!KEY;
declare global { interface Window { google?: any; __playnxMapsReady?: () => void } }

let loader: Promise<any> | null = null;
export function loadMaps(): Promise<any> {
  if (!KEY) return Promise.reject(new Error('Google Maps key not configured'));
  if (window.google?.maps) return Promise.resolve(window.google);
  loader ??= new Promise((resolve, reject) => {
    window.__playnxMapsReady = () => resolve(window.google);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&callback=__playnxMapsReady&loading=async`;
    s.async = true; s.onerror = () => { loader = null; reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(s);
  });
  return loader;
}

export const directionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/** Read-only map with one marker. Falls back to a directions link when no API key is configured. */
export function MapView({ lat, lng, name, className = 'h-64' }: { lat: number; lng: number; name?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(mapsEnabled ? null : 'Map preview needs a Google Maps key.');
  useEffect(() => {
    if (!mapsEnabled || !ref.current) return;
    let cancelled = false;
    loadMaps().then((g) => {
      if (cancelled || !ref.current) return;
      const map = new g.maps.Map(ref.current, { center: { lat, lng }, zoom: 15, disableDefaultUI: true, zoomControl: true });
      new g.maps.Marker({ position: { lat, lng }, map, title: name });
    }).catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, [lat, lng, name]);
  // no map key (or the map failed): show nothing rather than an empty box
  if (err) return null;
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-line bg-surface2 ${className}`}>
      <div ref={ref} className="h-full w-full" aria-label={`Map showing ${name ?? 'venue'}`} />
    </div>
  );
}

/** Click/drag to place the venue GPS pin. Always offers manual coordinates and device location. */
export function LocationPicker({ lat, lng, onChange, readOnly = false }: { lat?: number; lng?: number; onChange(lat: number, lng: number): void; readOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const marker = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const [geoErr, setGeoErr] = useState('');
  const [mapErr, setMapErr] = useState<string | null>(null);
  const cb = useRef(onChange); cb.current = readOnly ? () => {} : onChange;
  useEffect(() => { marker.current?.setDraggable?.(!readOnly); }, [readOnly]);

  useEffect(() => {
    if (!mapsEnabled || !ref.current) return;
    let cancelled = false;
    loadMaps().then((g) => {
      if (cancelled || !ref.current) return;
      const center = { lat: lat ?? 20.5937, lng: lng ?? 78.9629 };
      const map = new g.maps.Map(ref.current, { center, zoom: lat ? 15 : 5, streetViewControl: false, mapTypeControl: false });
      mapRef.current = map;
      marker.current = new g.maps.Marker({ position: center, map, draggable: !readOnly, visible: lat !== undefined });
      marker.current.addListener('dragend', (e: any) => cb.current(e.latLng.lat(), e.latLng.lng()));
      map.addListener('click', (e: any) => { marker.current.setVisible(true); marker.current.setPosition(e.latLng); cb.current(e.latLng.lat(), e.latLng.lng()); });
    }).catch((e) => setMapErr(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (marker.current && lat !== undefined && lng !== undefined) {
      marker.current.setVisible(true); marker.current.setPosition({ lat, lng }); mapRef.current?.panTo({ lat, lng });
    }
  }, [lat, lng]);

  const locate = () => {
    setGeoErr('');
    if (!navigator.geolocation) return setGeoErr('Location is not supported on this device');
    navigator.geolocation.getCurrentPosition((p) => onChange(+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6)), (e) => setGeoErr(e.message), { enableHighAccuracy: true, timeout: 10000 });
  };
  return (
    <div className="space-y-3">
      {mapsEnabled && !mapErr ? <div ref={ref} className="h-64 overflow-hidden rounded-2xl border border-line" /> : <p className="text-xs text-muted">{mapErr ?? 'Add VITE_GOOGLE_MAPS_KEY to pick the location on a map. You can still enter coordinates below.'}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input className="field" type="number" step="any" placeholder="Latitude" aria-label="Latitude" value={lat ?? ''} onChange={(e) => e.target.value !== '' && onChange(+e.target.value, lng ?? 0)} />
        <input className="field" type="number" step="any" placeholder="Longitude" aria-label="Longitude" value={lng ?? ''} onChange={(e) => e.target.value !== '' && onChange(lat ?? 0, +e.target.value)} />
      </div>
      <button type="button" className="btn-ghost" onClick={locate}>Use my current location</button>
      {geoErr && <p className="text-xs text-danger">{geoErr}</p>}
    </div>
  );
}

/** Map with a marker per venue. Without an API key it falls back to a list of direction links. */
export function VenuesMap({ points, className = 'h-[28rem]' }: { points: { id: string; name: string; lat: number; lng: number; price?: number | null }[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(mapsEnabled ? null : 'The map needs a Google Maps key. Use the directions links below instead.');
  useEffect(() => {
    if (!mapsEnabled || !ref.current || !points.length) return;
    let cancelled = false;
    loadMaps().then((g) => {
      if (cancelled || !ref.current) return;
      const map = new g.maps.Map(ref.current, { center: { lat: points[0].lat, lng: points[0].lng }, zoom: 11, streetViewControl: false, mapTypeControl: false });
      const bounds = new g.maps.LatLngBounds(); const info = new g.maps.InfoWindow();
      points.forEach((p) => {
        const m = new g.maps.Marker({ position: { lat: +p.lat, lng: +p.lng }, map, title: p.name });
        bounds.extend(m.getPosition());
        m.addListener('click', () => { const d = document.createElement('div'); const a = document.createElement('a'); a.href = `/venues/${p.id}`; a.textContent = p.name; a.style.fontWeight = '700'; a.style.color = '#c2410c'; d.appendChild(a); info.setContent(d); info.open(map, m); });
      });
      if (points.length > 1) map.fitBounds(bounds, 48);
    }).catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, [points]);
  if (!points.length) return null;
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-line bg-surface2 ${className}`}>
      {err ? (
        <ul className="h-full divide-y divide-line overflow-auto p-2 text-sm" aria-label="Venue locations"><li className="p-2 text-xs text-muted">{err}</li>
          {points.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 p-2"><a className="font-semibold" href={`/venues/${p.id}`}>{p.name}</a><a className="btn-ghost !py-1 text-xs" href={directionsUrl(p.lat, p.lng)} target="_blank" rel="noreferrer">Directions</a></li>)}</ul>
      ) : <div ref={ref} className="h-full w-full" aria-label="Map of venues" />}
    </div>
  );
}
