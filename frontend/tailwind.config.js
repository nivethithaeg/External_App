/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)', surface: 'rgb(var(--surface) / <alpha-value>)', surface2: 'rgb(var(--surface2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)', ink: 'rgb(var(--ink) / <alpha-value>)', muted: 'rgb(var(--muted) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)', 'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)', danger: 'rgb(var(--danger) / <alpha-value>)', warn: 'rgb(var(--warn) / <alpha-value>)', ok: 'rgb(var(--ok) / <alpha-value>)',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], display: ['"Barlow Condensed"', 'Inter', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgb(0 0 0 / .08), 0 8px 24px -12px rgb(0 0 0 / .35)' },
      keyframes: { rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } }, shimmer: { to: { backgroundPosition: '-200% 0' } }, pop: { '0%': { transform: 'scale(1)' }, '40%': { transform: 'scale(1.35)' }, '100%': { transform: 'scale(1)' } }, slide: { from: { opacity: 0, transform: 'translateY(-6px)' }, to: { opacity: 1, transform: 'none' } }, popIn: { from: { opacity: 0, transform: 'scale(.8)' }, to: { opacity: 1, transform: 'none' } }, slideX: { from: { opacity: 0, transform: 'translateX(-28px)' }, to: { opacity: 1, transform: 'none' } }, float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } }, drift: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(-40px,30px) scale(1.12)' } }, star: { from: { opacity: 0, transform: 'scale(0) rotate(-40deg)' }, to: { opacity: 1, transform: 'none' } }, glowSoft: { '0%,100%': { boxShadow: '0 0 0 0 rgb(21 21 21 / 0)' }, '50%': { boxShadow: '0 0 0 10px rgb(21 21 21 / .18)' } }, sheen: { from: { transform: 'translateX(-120%)' }, to: { transform: 'translateX(220%)' } }, bar: { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } }, glow: { '0%,100%': { boxShadow: '0 0 0 0 rgb(255 107 34 / .0)' }, '50%': { boxShadow: '0 0 0 8px rgb(255 107 34 / .18)' } } },
      animation: { rise: 'rise .35s ease-out both', shimmer: 'shimmer 1.4s linear infinite', pop: 'pop .4s ease-out', slide: 'slide .25s ease-out both', glow: 'glow 1.6s ease-in-out 3', popIn: 'popIn .45s cubic-bezier(.2,.9,.3,1.3) both', slideX: 'slideX .55s ease-out both', float: 'float 1.6s ease-in-out infinite', drift: 'drift 14s ease-in-out infinite', star: 'star .45s cubic-bezier(.2,.9,.3,1.4) both', glowSoft: 'glowSoft 2s ease-in-out 4', sheen: 'sheen 1.4s ease-in-out 2', bar: 'bar 5s linear both' },
    },
  },
  plugins: [],
};
