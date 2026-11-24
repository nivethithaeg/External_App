import type { Response } from 'express';
import type { Ctx } from '../types.js';
import { notFound } from '../errors.js';

/** Streams a stored document to an already-authorised caller. Private keys are never exposed; legacy public URLs redirect. */
export async function sendStoredFile(ctx: Ctx, res: Response, ref: string | null | undefined) {
  if (!ref) throw notFound('File not found');
  if (!ref.startsWith('private:') && !ref.startsWith('key:')) return res.redirect(ref);
  let file;
  try { file = await ctx.storage.getPrivate(ref.replace(/^(private|key):/, '')); } catch { throw notFound('File not found'); }
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.data);
}
export const maskUrl = "CASE WHEN url LIKE 'private:%' THEN NULL ELSE url END";
