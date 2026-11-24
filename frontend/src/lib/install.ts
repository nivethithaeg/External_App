import { useEffect, useState } from 'react';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let saved: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); saved = e as InstallEvent; listeners.forEach((l) => l()); });
  window.addEventListener('appinstalled', () => { saved = null; listeners.forEach((l) => l()); });
}

/** `canInstall` is true only when the browser is offering to install KickOff (Chrome, Edge and Android). `install()` shows its own install prompt. */
export function useInstallApp() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { canInstall: !!saved, install: async () => { const e = saved; if (!e) return; await e.prompt(); await e.userChoice; saved = null; listeners.forEach((l) => l()); } };
}
