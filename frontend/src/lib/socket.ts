import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef } from 'react';
import { getToken } from './api';

let socket: Socket | null = null;
let tokenUsed: string | null = null;

export function getSocket(): Socket {
  const t = getToken();
  if (!socket || tokenUsed !== t) {
    socket?.disconnect();
    tokenUsed = t;
    socket = io(import.meta.env.VITE_API_URL || undefined, { auth: t ? { token: t } : {}, transports: ['websocket', 'polling'] });
  }
  return socket;
}

/** Calls onChange whenever slots for the venue change (booking, hold, block, cancellation). */
export function useVenueRealtime(venueId: string | undefined, onChange: () => void) {
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    if (!venueId) return;
    const s = getSocket();
    const join = () => s.emit('venue:watch', venueId);
    const handler = () => cb.current();
    join(); s.on('connect', join); s.on('slots:changed', handler);
    return () => { s.emit('venue:unwatch', venueId); s.off('connect', join); s.off('slots:changed', handler); };
  }, [venueId]);
}

export function useNotificationSocket(enabled: boolean, onNotification: (n: any) => void) {
  const cb = useRef(onNotification); cb.current = onNotification;
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket(); const h = (n: any) => cb.current(n);
    s.on('notification', h);
    return () => { s.off('notification', h); };
  }, [enabled]);
}
