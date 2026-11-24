import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ (tsx) and from dist/src/ (compiled): migrations/ sits at the backend root.
export const MIGRATIONS_DIR = [path.resolve(here, '..', 'migrations'), path.resolve(here, '..', '..', 'migrations')].find((d) => fs.existsSync(d)) ?? path.resolve('migrations');

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.exec('BEGIN;\n' + sql + `\nINSERT INTO schema_migrations(name) VALUES ('${f}');\nCOMMIT;`);
    applied.push(f);
  }
  return applied;
}

// CLI entry: `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadConfig } = await import('./config.js');
  const { createPgDb } = await import('./db.js');
  const cfg = loadConfig();
  const db = createPgDb(cfg.DATABASE_URL, cfg.DATABASE_SSL === 'true');
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  await db.close();
}
