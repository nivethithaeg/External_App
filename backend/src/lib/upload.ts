import multer from 'multer';
import { badRequest } from '../errors.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

/** Detect type from file signature; the client-supplied mimetype/extension is never trusted. */
export function sniff(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  if (b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function checkedFile(file: Express.Multer.File | undefined, allowed: string[]) {
  if (!file) throw badRequest('No file uploaded', 'no_file');
  const type = sniff(file.buffer);
  if (!type || !allowed.includes(type)) throw badRequest(`Unsupported file type. Allowed: ${allowed.map((t) => t.split('/')[1]).join(', ')}`, 'bad_file_type');
  const limit = type.startsWith('image/') ? 8 * 1024 * 1024 : type === 'application/pdf' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > limit) throw badRequest(`File too large (max ${limit / 1024 / 1024} MB for this type)`, 'file_too_large');
  return { buffer: file.buffer, type };
}
