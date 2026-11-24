import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './ui';

/**
 * A live camera for the self-verification photo: front camera on a phone, the webcam on a computer.
 * It captures a still frame as a JPEG file. Where there is no camera (or access is blocked) it says so and the caller can fall back to a file.
 */
export function FaceCamera({ open, onClose, onCapture }: { open: boolean; onClose(): void; onCapture(file: File): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState(''); const [ready, setReady] = useState(false);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setReady(false); };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) { setError('The camera is not available here. Use a device with a camera, over a secure (https) connection, and allow camera access.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; void video.current.play?.().catch(() => undefined); }
        setReady(true);
      })
      .catch(() => setError('We could not open the camera. Allow camera access in your browser and try again.'));
    return () => { cancelled = true; stop(); };
  }, [open]);

  const snap = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return setError('The photo could not be taken. Try again.');
      stop(); onCapture(new File([blob], `self-verification-${Date.now()}.jpg`, { type: 'image/jpeg' })); onClose();
    }, 'image/jpeg', 0.9);
  };

  return (
    <Modal open={open} onClose={() => { stop(); onClose(); }} title="Take your verification photo">
      <div className="space-y-3">
        <p className="text-sm text-muted">Face the camera, remove sunglasses or masks, and make sure your whole face is visible.</p>
        {error ? <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          : <video ref={video} playsInline muted aria-label="Camera preview" className="aspect-[4/3] w-full rounded-xl bg-black object-cover [transform:scaleX(-1)]" />}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { stop(); onClose(); }}>Cancel</Button><Button onClick={snap} disabled={!ready || !!error}>Take photo</Button></div>
      </div>
    </Modal>
  );
}
