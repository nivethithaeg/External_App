import { cx } from '../lib/utils';

/*
 * The PlaynX logo as supplied (public/brand/playnx-logo.png), with its white background made transparent so it sits on
 * any background. On dark backgrounds (navy footer, dark mode) the navy letters show in white.
 */
const SRC = { light: '/brand/playnx-logo-transparent.png', dark: '/brand/playnx-logo-light.png' };
const MARK = { light: '/brand/playnx-mark.png', dark: '/brand/playnx-mark-light.png' };

/** Pick the right image for the background: `onDark` forces the white-letter version (for a navy footer). */
function Themed({ src, onDark, alt, className, style }: { src: { light: string; dark: string }; onDark?: boolean; alt: string; className?: string; style?: React.CSSProperties }) {
  if (onDark) return <img src={src.dark} alt={alt} className={className} style={style} />;
  return <>
    <img src={src.light} alt={alt} className={cx(className, 'dark:hidden')} style={style} />
    <img src={src.dark} alt={alt} aria-hidden={alt ? undefined : true} className={cx(className, 'hidden dark:block')} style={style} />
  </>;
}

/** Small square spot (collapsed sidebar): the logo's "P" with the play button. */
export function LogoMark({ size = 36, onDark }: { size?: number; onDark?: boolean }) {
  return <Themed src={MARK} onDark={onDark} alt="" className="object-contain" style={{ width: size, height: size }} />;
}

export function Logo({ className, subtitle, onDark }: { className?: string; subtitle?: string; onDark?: boolean }) {
  return (
    <span className={cx('inline-flex flex-col items-start gap-1', className)}>
      <Themed src={SRC} onDark={onDark} alt="PlaynX" className="h-11 w-auto" />
      {subtitle && <span className="block text-[10px] font-semibold uppercase tracking-[.2em] text-muted">{subtitle}</span>}
    </span>
  );
}
