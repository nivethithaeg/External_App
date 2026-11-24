import { useState } from 'react';
import { money } from '../lib/utils';

/** Accessible SVG bar chart with hover/focus tooltips and a text table fallback for screen readers. */
export function BarChart({ data, valueKey, labelKey, height = 180, currency = true, title }: {
  data: Record<string, any>[]; valueKey: string; labelKey: string; height?: number; currency?: boolean; title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  const w = 100 / Math.max(1, data.length);
  const fmt = (n: number) => (currency ? money(n) : String(n));
  const point = hover !== null ? data[hover] : null;
  return (
    <figure className="w-full">
      <div className="mb-2 flex h-5 items-center justify-between text-xs text-muted">
        <span>{title}</span>
        <span className="font-semibold text-ink" aria-live="polite">{point ? `${point[labelKey]} · ${fmt(Number(point[valueKey]) || 0)}` : `Peak ${fmt(max)}`}</span>
      </div>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={title}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={(height / 4) * g} y2={(height / 4) * g} stroke="rgb(var(--line))" strokeWidth=".3" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0, h = (v / max) * (height / 4 - 2);
          return (
            <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={height / 4 - h} height={Math.max(h, v > 0 ? 0.6 : 0)} rx="0.8"
              fill={hover === i ? 'rgb(var(--brand))' : 'rgb(var(--brand) / .65)'} tabIndex={0}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted"><span>{data[0]?.[labelKey]}</span><span>{data.at(-1)?.[labelKey]}</span></div>
      <div className="sr-only"><table><caption>{title}</caption><tbody>{data.map((d, i) => <tr key={i}><th>{d[labelKey]}</th><td>{fmt(Number(d[valueKey]) || 0)}</td></tr>)}</tbody></table></div>
    </figure>
  );
}
