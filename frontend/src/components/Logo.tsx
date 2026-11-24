import { cx } from '../lib/utils';

/** KickOff mark: an orange ball in motion (speed lines) inside a charcoal rounded square. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#151515" />
      <circle cx="34" cy="32" r="16" fill="#FF6B22" />
      <path d="M34 22l7 5-2.7 8h-8.6L27 27z" fill="#151515" />
      <path d="M34 22v-6M41 27l5-3M38.3 35l4 5M29.7 35l-4 5M27 27l-5-3" stroke="#151515" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 24h10M5 32h12M8 40h10" stroke="#FF6B22" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="leading-none">
        <span className="block font-display text-2xl font-extrabold uppercase tracking-wide">Kick<span className="text-[rgb(var(--brand-text))]">Off</span></span>
        {subtitle && <span className="block text-[10px] font-semibold uppercase tracking-[.2em] text-muted">{subtitle}</span>}
      </span>
    </span>
  );
}
