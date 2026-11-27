import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './utils';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string }
const Ctx = createContext<{ toast(text: string, kind?: Kind): void }>({ toast() {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 sm:w-96" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('toast-in rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur bg-surface',
            t.kind === 'success' && 'border-ok/40', t.kind === 'error' && 'border-danger/50', t.kind === 'info' && 'border-line')}>
            <span className={cx('toast-mark mr-2 inline-block font-bold', t.kind === 'success' && 'text-ok', t.kind === 'error' && 'text-danger')}>{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>{t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
