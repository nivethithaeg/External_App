import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Queryable } from '../db.js';

/** Tables that hold secrets or only matter for a few minutes; they are left out of backups. */
const SKIP = new Set(['schema_migrations', 'slot_locks', 'webhook_events', 'otp_codes']);

/**
 * Writes every table to its own gzip-compressed NDJSON file (one JSON row per line) in a dated folder, then deletes folders older than `keepDays`.
 * It uses only SQL, so it works on any Postgres without pg_dump. Restore = read each file and INSERT the rows.
 */
export async function backupDatabase(db: Queryable, rootDir: string, opts: { now?: Date; keepDays?: number } = {}) {
  const now = opts.now ?? new Date();
  const dir = path.join(rootDir, now.toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(dir, { recursive: true });
  const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows
    .map((r) => r.table_name).filter((t) => !SKIP.has(t));
  const manifest: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await db.query(`SELECT * FROM "${t.replace(/"/g, '')}"`);
    manifest[t] = rows.length;
    await pipeline(Readable.from(rows.map((r) => JSON.stringify(r) + '\n')), zlib.createGzip(), fs.createWriteStream(path.join(dir, `${t}.ndjson.gz`)));
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ createdAt: now.toISOString(), tables: manifest }, null, 2));
  const keep = (opts.keepDays ?? 14) * 86400000;
  for (const d of fs.readdirSync(rootDir)) {
    const full = path.join(rootDir, d);
    if (full !== dir && fs.statSync(full).isDirectory() && /^\d{4}-\d\d-\d\dT/.test(d) && now.getTime() - fs.statSync(full).mtimeMs > keep) fs.rmSync(full, { recursive: true, force: true });
  }
  return { dir, tables: manifest };
}
