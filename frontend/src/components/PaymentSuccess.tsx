import { useEffect, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const GREEN = '#43C85A';
const COLORS = [GREEN, '#2FA84A', '#FFFFFF', '#FFFFFF', '#B8BCC2', '#D9DCE0'];
type Shape = 'square' | 'rect' | 'star';
interface Piece { id: number; left: number; size: number; shape: Shape; color: string; sway: number; spin: number; delay: number; dur: number; drop: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function makePieces(n: number): Piece[] {
  return Array.from({ length: n }, (_, id) => ({
    id, left: rnd(4, 96), size: rnd(5, 11), shape: (['square', 'rect', 'star'] as Shape[])[id % 3], color: COLORS[Math.floor(rnd(0, COLORS.length))],
    sway: rnd(-40, 40), spin: rnd(-540, 540), delay: 0.7 + rnd(0, 0.5), dur: rnd(2.1, 2.9), drop: rnd(300, 470),
  }));
}
const STAR = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';

function Confetti() {
  const pieces = useMemo(() => makePieces(34), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span key={p.id} className="absolute top-0 block"
          style={{ left: `${p.left}%`, width: p.shape === 'rect' ? p.size * 0.5 : p.size, height: p.shape === 'rect' ? p.size * 1.5 : p.size, background: p.color, clipPath: p.shape === 'star' ? STAR : undefined, borderRadius: p.shape === 'square' ? 1.5 : 1, willChange: 'transform, opacity' }}
          initial={{ y: -16, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: p.drop, x: p.sway, rotate: p.spin, opacity: [0, 1, 1, 0] }}
          transition={{ delay: p.delay, duration: p.dur, ease: [0.25, 0.6, 0.4, 1], opacity: { delay: p.delay, duration: p.dur, times: [0, 0.1, 0.7, 1] } }} />
      ))}
      {[{ l: 14, c: GREEN, h: 120 }, { l: 38, c: '#FFFFFF', h: 90 }, { l: 66, c: '#B8BCC2', h: 110 }, { l: 86, c: GREEN, h: 100 }].map((s, i) => (
        <motion.svg key={i} width="26" height={s.h} viewBox={`0 0 26 ${s.h}`} className="absolute top-0" style={{ left: `${s.l}%`, transformOrigin: '50% 0%' }}
          initial={{ opacity: 0, rotate: -6, y: -10 }} animate={{ opacity: [0, 0.9, 0.9, 0], rotate: [-6, 8, -5, 6], y: [-10, 6, 14, 26] }}
          transition={{ delay: 0.75 + i * 0.1, duration: 2.6, ease: 'easeInOut', opacity: { times: [0, 0.15, 0.7, 1], duration: 2.6, delay: 0.75 + i * 0.1 } }}>
          <path d={`M13 0 C 2 ${s.h * 0.25}, 24 ${s.h * 0.5}, 10 ${s.h * 0.78} S 16 ${s.h - 4}, 13 ${s.h - 2}`} fill="none" stroke={s.c} strokeWidth="3" strokeLinecap="round" />
        </motion.svg>))}
    </div>
  );
}

/** A full-screen "Payment succeeded!" celebration. Render it only after the payment has been verified by the server. */
export function PaymentSuccess({ onDashboard, onClose }: { onDashboard(): void; onClose(): void }) {
  const reduce = !!useReducedMotion();
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const fade = (delay: number, duration: number, y = 12) => reduce ? { initial: false as const } : ({ initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, transition: { delay, duration, ease: 'easeOut' as const } });
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="pay-ok-h" aria-describedby="pay-ok-d"
        className="relative w-full max-w-[420px] overflow-hidden rounded-3xl px-6 pb-9 pt-12 text-center shadow-[0_24px_60px_rgba(0,0,0,.55)] sm:px-10" style={{ background: '#303030' }}
        initial={reduce ? false : { opacity: 0, scale: 0.95, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }}>
        {!reduce && <Confetti />}
        <motion.div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full" style={{ background: GREEN, boxShadow: '0 0 34px rgba(67,200,90,.55)' }}
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, duration: 0.7, type: 'spring', stiffness: 260, damping: 14 }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <motion.path d="M10 21 L17.5 28.5 L30 12" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.85, duration: 0.4, ease: 'easeOut' }} />
          </svg>
        </motion.div>
        <motion.h2 id="pay-ok-h" className="mt-7 font-display text-3xl font-extrabold text-white sm:text-4xl" {...fade(1.0, 0.5)}
          {...(reduce ? {} : { animate: { opacity: 1, y: 0, scale: [1, 1.05, 1] }, transition: { delay: 1.0, duration: 0.5, ease: 'easeOut', scale: { delay: 1.4, duration: 0.4 } } })}>Payment Succeeded!</motion.h2>
        <motion.p id="pay-ok-d" className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-[#B8BCC2]" {...fade(1.4, 0.4, 8)}>
          Your transaction was completed successfully. Thank you for your purchase!</motion.p>
        <motion.button type="button" autoFocus onClick={onDashboard}
          className="mt-7 rounded-xl px-6 py-3 text-sm font-bold text-[#0f1a12] outline-none focus-visible:ring-2 focus-visible:ring-white" style={{ background: GREEN, boxShadow: '0 0 22px rgba(67,200,90,.4)' }}
          initial={reduce ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.8, duration: 0.5, ease: 'easeOut' }}
          whileHover={reduce ? undefined : { scale: 1.05, filter: 'brightness(1.1)' }} whileTap={reduce ? undefined : { scale: 0.96 }}>
          Go to Your Dashboard
        </motion.button>
      </motion.div>
    </div>
  );
}
