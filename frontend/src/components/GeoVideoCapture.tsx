import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './ui';

/** A video recorded at the venue with the phone's live location at the moment it was recorded. */
export interface GeoVideo { file: File; previewUrl: string; lat: number; lng: number; accuracy: number; seconds: number }
const MAX_SECONDS = 30;

/**
 * JusGo's "geo-tagged video": the owner records a short video at the venue with the in-app camera. There is no way to choose a file.
 * The phone's location is read while recording; the server checks it against the venue and keeps it with the video.
 */
export function GeoVideoCapture({ value, onChange, error, disabled }: { value: GeoVideo | null; onChange(v: GeoVideo | null): void; error?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-invalid={error ? 'true' : undefined} className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold after:ml-1 after:font-bold after:text-danger after:content-['*']">Geo-tagged video</p>
          <p className="text-xs text-muted">Record a short video (up to {MAX_SECONDS} seconds) at the venue with the camera in the app. Your phone's location is saved with it. Video cannot be uploaded from files.</p></div>
        <Button type="button" variant={value ? 'ghost' : 'primary'} className="!py-1.5" disabled={disabled} onClick={() => setOpen(true)}>{value ? 'Record again' : 'Record video'}</Button>
      </div>
      {value && <div className="flex flex-wrap items-center gap-3"><video src={value.previewUrl} controls muted className="h-24 rounded-lg border border-line" aria-label="Recorded video" />
        <p className="text-xs text-ok">✓ Recorded ({value.seconds} s) · location {value.lat.toFixed(5)}, {value.lng.toFixed(5)} (accurate to about {Math.round(value.accuracy)} m)</p></div>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {open && <Recorder onClose={() => setOpen(false)} onDone={(v) => { onChange(v); setOpen(false); }} />}
    </div>
  );
}

function Recorder({ onClose, onDone }: { onClose(): void; onDone(v: GeoVideo): void }) {
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const rec = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]);
  const pos = useRef<{ lat: number; lng: number; accuracy: number } | null>(null); const started = useRef(0);
  const [cam, setCam] = useState<'starting' | 'ready' | string>('starting'); const [place, setPlace] = useState(''); const [recording, setRecording] = useState(false); const [secs, setSecs] = useState(0); const [err, setErr] = useState('');

  useEffect(() => { // the camera
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setCam('Recording is not available here. Open this page on your phone, over a secure (https) connection, and allow camera access.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: true })
      .then((s) => { if (cancelled) return s.getTracks().forEach((t) => t.stop()); stream.current = s; if (video.current) { video.current.srcObject = s; video.current.play?.().catch(() => {}); } setCam('ready'); })
      .catch((e: Error) => setCam(e?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera and microphone for this site in your browser settings, then try again.' : 'No camera could be started on this device.'));
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => { // the live location, kept fresh while the camera is open
    if (!navigator.geolocation) { setPlace('This device cannot share its location.'); return; }
    const id = navigator.geolocation.watchPosition((p) => { pos.current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; setPlace(`Location ready, accurate to about ${Math.round(p.coords.accuracy)} m`); },
      (e) => setPlace(e.code === 1 ? 'Location was blocked. Allow location for this site in your browser settings.' : 'Your location is not available yet. Turn on GPS and wait a few seconds.'), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  useEffect(() => { if (!recording) return; const t = setInterval(() => { const s = Math.round((Date.now() - started.current) / 1000); setSecs(s); if (s >= MAX_SECONDS) stop(); }, 500); return () => clearInterval(t); }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    setErr(''); if (!pos.current) return setErr('Wait for the location to be ready, then start recording.');
    if (!stream.current) return;
    chunks.current = []; const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined); rec.current = r;
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const type = r.mimeType || 'video/webm'; const blob = new Blob(chunks.current, { type }); const p = pos.current;
      if (!p || blob.size < 1000) return setErr('The video was too short. Record again.');
      const file = new File([blob], `venue-video.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
      onDone({ file, previewUrl: URL.createObjectURL(file), lat: p.lat, lng: p.lng, accuracy: p.accuracy, seconds: Math.max(1, Math.round((Date.now() - started.current) / 1000)) });
    };
    started.current = Date.now(); setSecs(0); r.start(); setRecording(true);
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); setRecording(false); };

  return (
    <Modal open onClose={() => { if (!recording) onClose(); }} title="Record a video at the venue">
      <div className="space-y-3">
        {cam === 'starting' ? <p className="text-sm text-muted">Starting the camera…</p> : cam !== 'ready' ? <p role="alert" className="text-sm text-danger">{cam}</p>
          : <video ref={video} muted playsInline className="aspect-video w-full rounded-xl bg-black object-cover" aria-label="Camera" />}
        <p className="text-xs text-muted" aria-live="polite">{place || 'Getting your location…'}</p>
        {recording && <p className="text-sm font-semibold text-danger" aria-live="polite">● Recording {secs} s (up to {MAX_SECONDS} s)</p>}
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={recording} onClick={onClose}>Cancel</Button>
          {recording ? <Button type="button" variant="danger" onClick={stop}>Stop</Button> : <Button type="button" disabled={cam !== 'ready'} onClick={start}>Start recording</Button>}</div>
      </div>
    </Modal>
  );
}
