import { useEffect, useRef, useState } from 'react';
import { api, apiError } from '../lib/api';
import { Button, Modal } from './ui';

/** A photo taken live, together with the phone's live location, and the server's proof that both were checked at the venue. */
export interface LiveShot { file: File; previewUrl: string; proof: string; distanceM: number; accuracyM: number; lat: number; lng: number; address: string | null }

type Position = { lat: number; lng: number; accuracy: number };

/**
 * An in-app camera: the owner sees the live picture, the phone's location is read at the same moment, and pressing the button takes the photo.
 * There is no way to choose a file here. The server checks the location against the venue and signs a proof for exactly this photo.
 */
export function LiveCamera({ venueId, onShot, onClose }: { venueId: string; onShot(s: LiveShot): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<'starting' | 'ready' | string>('starting'); // a string other than the two states is an error message
  const [pos, setPos] = useState<Position | null>(null); const [posErr, setPosErr] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [shot, setShot] = useState<LiveShot | null>(null); // the photo just taken, shown with where it was taken before it is kept

  useEffect(() => { // the camera
    let stream: MediaStream | null = null; let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCam('The camera is not available here. Open this page on your phone, over a secure (https) connection, and allow camera access.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => { if (cancelled) return s.getTracks().forEach((t) => t.stop()); stream = s; if (video.current) { video.current.srcObject = s; video.current.play?.().catch(() => {}); } setCam('ready'); })
      .catch((e: Error) => setCam(e?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.' : 'No camera could be started on this device.'));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => { // the live location, kept fresh while the camera is open
    if (!navigator.geolocation) { setPosErr('Location is not available on this device.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setPosErr(''); },
      (e) => setPosErr(e.code === 1 ? 'Location access was blocked. Allow location for this site in your browser settings, then try again.' : 'Your location could not be found yet. Go outside onto the turf and wait a few seconds.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    return () => navigator.geolocation?.clearWatch(id);
  }, []);

  const take = async () => {
    if (!pos || !video.current) return; setErr(''); setBusy(true);
    try {
      const v = video.current; const w = v.videoWidth || 1280, h = v.videoHeight || 720; const scale = Math.min(1, 1600 / Math.max(w, h));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('The photo could not be taken. Try again.');
      const file = new File([blob], `live-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const fd = new FormData(); fd.append('file', file); fd.append('lat', String(pos.lat)); fd.append('lng', String(pos.lng)); fd.append('accuracy', String(pos.accuracy));
      const r = await api.post(`/owner/venues/${venueId}/media/live-check`, fd, { timeout: 60000 }); // the server checks where you are and signs a proof for this photo
      setShot({ file, previewUrl: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '', proof: r.data.proof, distanceM: r.data.distanceM, accuracyM: r.data.accuracyM, lat: r.data.lat ?? pos.lat, lng: r.data.lng ?? pos.lng, address: r.data.address ?? null });
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  };

  const ready = cam === 'ready' && !!pos;
  return (
    <Modal open onClose={onClose} title="Take a live photo">
      <div className="space-y-3 text-sm">
        <p className="text-muted">{shot ? 'Check where the photo was taken. If it looks right, use it. Otherwise retake it.' : 'Stand on the turf and point the camera at the playing area. Your location is read at the same moment as the photo.'}</p>
        <div className={`relative overflow-hidden rounded-xl bg-black ${shot ? 'hidden' : ''}`}>
          <video ref={video} playsInline muted autoPlay aria-label="Live camera" className="aspect-[4/3] w-full object-cover" />
          {cam === 'starting' && <p className="absolute inset-0 grid place-items-center text-white/80">Starting the camera…</p>}
          {cam !== 'starting' && cam !== 'ready' && <p role="alert" className="absolute inset-0 grid place-items-center p-4 text-center text-white">{cam}</p>}
        </div>
        {shot && (
          <section aria-label="Where the photo was taken" className="space-y-3">
            {shot.previewUrl && <img src={shot.previewUrl} alt="The photo you just took" className="aspect-[4/3] w-full rounded-xl object-cover" />}
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 rounded-xl border border-line p-3">
              <dt className="text-xs uppercase tracking-wide text-muted">Latitude</dt><dd className="font-mono font-semibold">{shot.lat.toFixed(6)}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted">Longitude</dt><dd className="font-mono font-semibold">{shot.lng.toFixed(6)}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted">Address</dt><dd className="font-semibold">{shot.address ?? <span className="font-normal text-muted">Address not available for this spot</span>}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted">From venue</dt><dd>{shot.distanceM} m away (location accurate to about {shot.accuracyM} m)</dd>
            </dl>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { if (shot.previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(shot.previewUrl); setShot(null); }}>Retake</Button>
              <Button type="button" onClick={() => onShot(shot)}>Use this photo</Button></div>
          </section>)}
        <ul className={`space-y-0.5 text-xs ${shot ? 'hidden' : ''}`} aria-label="Status">
          <li className={cam === 'ready' ? 'text-ok' : 'text-muted'}>{cam === 'ready' ? '✓ Camera ready' : 'Camera: waiting'}</li>
          <li className={pos ? (pos.accuracy <= 150 ? 'text-ok' : 'text-warn') : posErr ? 'text-danger' : 'text-muted'}>
            {pos ? `${pos.accuracy <= 150 ? '✓' : '!'} Location found (accurate to about ${Math.round(pos.accuracy)} m)${pos.accuracy > 150 ? '. Too rough: step outside and wait a few seconds' : ''}` : posErr || 'Finding your location…'}</li>
        </ul>
        {err && !shot && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-danger">{err}</p>}
        {!shot && <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready} loading={busy} onClick={take}>📷 Take photo</Button></div>}
      </div>
    </Modal>
  );
}
