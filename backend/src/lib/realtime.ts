import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { Config } from '../config.js';

export interface Realtime {
  toVenue(venueId: string, event: string, payload: unknown): void;
  toUser(userId: string, event: string, payload: unknown): void;
}
export const noopRealtime: Realtime = { toVenue() {}, toUser() {} };

export function attachRealtime(http: HttpServer, cfg: Config): Realtime {
  const io = new Server(http, { cors: { origin: cfg.CORS_ORIGINS.split(','), credentials: true } });
  io.use((socket, next) => {
    // Auth is optional: anonymous sockets may watch public venue availability only.
    const token = socket.handshake.auth?.token;
    if (token) {
      try { socket.data.userId = (jwt.verify(token, cfg.JWT_SECRET) as any).sub; } catch { return next(new Error('invalid token')); }
    }
    next();
  });
  io.on('connection', (socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    socket.on('venue:watch', (id: unknown) => { if (typeof id === 'string' && id.length < 64) socket.join(`venue:${id}`); });
    socket.on('venue:unwatch', (id: unknown) => { if (typeof id === 'string') socket.leave(`venue:${id}`); });
  });
  return {
    toVenue: (id, ev, p) => void io.to(`venue:${id}`).emit(ev, p),
    toUser: (id, ev, p) => void io.to(`user:${id}`).emit(ev, p),
  };
}
