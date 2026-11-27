import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
const Ctx = createContext<{ theme: Theme; toggle(): void }>({ theme: 'light', toggle() {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.getAttribute('data-theme') as Theme) || 'light');
  const first = useRef(true);
  useEffect(() => {
    const root = document.documentElement;
    // after the first paint, a switch cross-fades the colours for a moment (CSS .theme-switching; off with reduced motion)
    let t: ReturnType<typeof setTimeout> | undefined;
    if (!first.current) { root.classList.add('theme-switching'); t = setTimeout(() => root.classList.remove('theme-switching'), 350); }
    first.current = false;
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('playnx_theme', theme); } catch { /* ignore */ }
    return () => { if (t) { clearTimeout(t); root.classList.remove('theme-switching'); } };
  }, [theme]);
  return <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>{children}</Ctx.Provider>;
}
