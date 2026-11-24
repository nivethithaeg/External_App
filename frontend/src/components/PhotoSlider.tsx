import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '../lib/utils';

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Moves to the next photo by itself while a venue or playing area has more than one. Picking a photo by hand starts the wait again, so the
 * photo someone chose is not snatched away at once. Not used when the person prefers reduced motion, or while `paused` (a video is playing, say).
 */
export function useAutoSlide(count: number, index: number, setIndex: (n: number) => void, opts: { ms?: number; paused?: boolean } = {}) {
  const { ms = 4000, paused = false } = opts;
  useEffect(() => {
    if (count < 2 || paused || reducedMotion()) return;
    const t = setTimeout(() => setIndex((index + 1) % count), ms);
    return () => clearTimeout(t);
  }, [count, index, paused, ms, setIndex]);
}

/** A photo area that fades through its photos on its own, with dots to jump to one. Pauses while the pointer is over it. */
export function PhotoSlider({ photos, alt, fallback, className, ms = 4000 }: { photos: { id?: string; url: string }[]; alt: string; fallback?: ReactNode; className?: string; ms?: number }) {
  const [i, setI] = useState(0); const [hover, setHover] = useState(false);
  const n = photos.length; const cur = Math.min(i, Math.max(n - 1, 0));
  useAutoSlide(n, cur, setI, { ms, paused: hover });
  if (!n) return <div className={cx('h-full w-full', className)}>{fallback}</div>;
  return (
    <div className={cx('relative h-full w-full overflow-hidden', className)} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} data-slider={n > 1 ? 'true' : undefined}>
      {photos.map((p, k) => <img key={p.id ?? p.url} src={p.url} alt={k === cur ? `${alt} photo ${k + 1} of ${n}` : ''} aria-hidden={k === cur ? undefined : true} loading={k === 0 ? undefined : 'lazy'}
        className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-700', k === cur ? 'opacity-100' : 'opacity-0')} />)}
      {n > 1 && <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" role="group" aria-label={`${alt} photos`}>
        {photos.map((p, k) => <button key={p.id ?? p.url} type="button" aria-label={`Show photo ${k + 1}`} aria-pressed={k === cur} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setI(k); }}
          className={cx('h-1.5 rounded-full transition-all', k === cur ? 'w-5 bg-brand' : 'w-1.5 bg-white/70 hover:bg-white')} />)}</div>}
    </div>);
}
