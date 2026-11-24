import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';

export interface Storage {
  /** Public media (venue photos, banners). Returns a public URL. */
  upload(folder: string, filename: string, data: Buffer, contentType: string): Promise<string>;
  /** Sensitive documents (identity, business, venue proofs). Stored privately; returns an opaque key, never a URL. */
  putPrivate(folder: string, data: Buffer, contentType: string): Promise<string>;
  getPrivate(key: string): Promise<{ data: Buffer; contentType: string }>;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
};
const TYPE_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));
export const ALLOWED_TYPES = Object.keys(EXT);

/** Supabase Storage when configured; local disk for development. Private files live in a separate non-public bucket/folder. */
export function createStorage(cfg: Config, uploadDir = path.resolve('uploads'), privateDir = path.resolve('private-uploads')): Storage {
  const safeName = (ct: string) => `${crypto.randomUUID()}.${EXT[ct] ?? 'bin'}`; // never trust client filenames
  const safeFolder = (f: string) => f.replace(/[^a-zA-Z0-9_/-]/g, '').replace(/\.\./g, '');
  if (cfg.SUPABASE_URL && cfg.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    return {
      async upload(folder, _f, data, contentType) {
        const key = `${folder}/${safeName(contentType)}`;
        const { error } = await sb.storage.from(cfg.SUPABASE_BUCKET).upload(key, data, { contentType, upsert: false });
        if (error) throw new Error(`Storage upload failed: ${error.message}`);
        return sb.storage.from(cfg.SUPABASE_BUCKET).getPublicUrl(key).data.publicUrl;
      },
      async putPrivate(folder, data, contentType) {
        const key = `${safeFolder(folder)}/${safeName(contentType)}`;
        const { error } = await sb.storage.from(cfg.SUPABASE_PRIVATE_BUCKET).upload(key, data, { contentType, upsert: false });
        if (error) throw new Error(`Private upload failed: ${error.message}`);
        return key;
      },
      async getPrivate(key) {
        const { data, error } = await sb.storage.from(cfg.SUPABASE_PRIVATE_BUCKET).download(key);
        if (error || !data) throw new Error(`Private download failed: ${error?.message ?? 'not found'}`);
        return { data: Buffer.from(await data.arrayBuffer()), contentType: data.type || TYPE_BY_EXT[key.split('.').pop() ?? ''] || 'application/octet-stream' };
      },
    };
  }
  return {
    async upload(folder, _f, data, contentType) {
      const name = safeName(contentType);
      const dir = path.join(uploadDir, folder.replace(/[^a-zA-Z0-9_-]/g, ''));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), data);
      return `${cfg.PUBLIC_API_URL}/uploads/${path.basename(dir)}/${name}`;
    },
    async putPrivate(folder, data, contentType) {
      const key = `${safeFolder(folder)}/${safeName(contentType)}`;
      const full = path.join(privateDir, key);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
      return key;
    },
    async getPrivate(key) {
      const full = path.join(privateDir, safeFolder(path.dirname(key)), path.basename(key));
      if (!full.startsWith(privateDir)) throw new Error('Invalid key');
      return { data: fs.readFileSync(full), contentType: TYPE_BY_EXT[path.extname(full).slice(1)] ?? 'application/octet-stream' };
    },
  };
}
