import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A 360° photo you can look around in: drag (mouse or finger) or use the arrow keys to turn. The photo is a wide panorama
 * (equirectangular), repeated side by side so turning never reaches an edge. It also turns slowly on its own until touched.
 */
export function PanoramaViewer({ src, alt, height = 320 }: { src: string; alt: string; height?: number }) {
  const [x, setX] = useState(0); const [moved, setMoved] = useState(false);
  const drag = useRef<{ startX: number; startPos: number } | null>(null);
  useEffect(() => { // a slow turn until the viewer is touched
    if (moved || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setX((v) => v - 0.6), 40);
    return () => clearInterval(t);
  }, [moved]);
  const down = (e: PointerEvent<HTMLDivElement>) => { setMoved(true); drag.current = { startX: e.clientX, startPos: x }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag.current) setX(drag.current.startPos + (e.clientX - drag.current.startX)); };
  const up = () => { drag.current = null; };
  const key = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'ArrowLeft') { setMoved(true); setX((v) => v + 40); } if (e.key === 'ArrowRight') { setMoved(true); setX((v) => v - 40); } };
  return (
    <div role="img" aria-label={`${alt}. Drag or use the arrow keys to look around.`} tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
      className="relative w-full cursor-grab touch-pan-y select-none overflow-hidden rounded-xl bg-surface2 outline-none focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing"
      style={{ height, backgroundImage: `url("${src}")`, backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%', backgroundPosition: `${x}px center` }}>
      <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">360° · drag to look around</span>
    </div>);
}
