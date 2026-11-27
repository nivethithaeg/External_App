import { useEffect } from 'react';

/**
 * A soft ripple from where a button is pressed (every .btn, .btn-primary, .btn-ghost, .btn-danger and pressable chip).
 * One listener for the whole app; the ripple itself is CSS (.btn-ripple::after), so React never sees extra elements.
 */
export function ButtonRipple() {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const on = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.('.btn, .btn-primary, .btn-ghost, .btn-danger, button.chip') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled) return;
      const b = t.getBoundingClientRect();
      t.style.setProperty('--rx', `${e.clientX - b.left}px`); t.style.setProperty('--ry', `${e.clientY - b.top}px`);
      t.style.setProperty('--rs', `${Math.max(b.width, b.height) * 2.2}px`);
      if (getComputedStyle(t).position === 'static') t.classList.add('btn-ripple-rel'); // a positioned button keeps its own position
      t.classList.remove('btn-ripple'); void t.offsetWidth; t.classList.add('btn-ripple');
      window.setTimeout(() => t.classList.remove('btn-ripple', 'btn-ripple-rel'), 650);
    };
    document.addEventListener('pointerdown', on, { passive: true });
    return () => document.removeEventListener('pointerdown', on);
  }, []);
  return null;
}
