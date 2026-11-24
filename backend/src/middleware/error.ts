import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors.js';
import { reportError } from '../lib/monitor.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'validation_error', message: 'Invalid input',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  // Postgres: exclusion violation = overlapping reservation, unique violation, FK
  if (err?.code === '23P01') return res.status(409).json({ error: { code: 'slot_unavailable', message: 'That time slot is no longer available' } });
  if (err?.code === '23505') return res.status(409).json({ error: { code: 'duplicate', message: 'A record with these details already exists' } });
  if (err?.code === '23503') return res.status(409).json({ error: { code: 'in_use', message: 'Record is referenced by other data' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
  if (err?.name === 'MulterError') return res.status(400).json({ error: { code: 'upload_error', message: err.message } });
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.error(`[unhandled ${ref}]`, err);
  reportError(err, { ref, method: req.method, path: req.path, ...(req.user ? { userId: req.user.id } : {}), source: 'server' });
  res.status(500).json({ error: { code: 'internal', reference: ref, message: `Something went wrong on our side (reference ${ref}). Please try again, or contact support and quote this reference.` } });
}
