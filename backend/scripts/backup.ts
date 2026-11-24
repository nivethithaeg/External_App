// Usage: npm run backup [-- <folder>]   Saves every table to <folder>/<date>/ (default: backups/). Run it daily and keep a copy off this machine.
import path from 'node:path';
import { createPgDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { backupDatabase } from '../src/lib/backup.js';

const cfg = loadConfig();
const db = createPgDb(cfg.DATABASE_URL, cfg.DATABASE_SSL === 'true');
const out = await backupDatabase(db, path.resolve(process.argv[2] ?? 'backups'), { keepDays: Number(process.env.BACKUP_KEEP_DAYS ?? 14) });
console.log(`Backup written to ${out.dir}`);
console.table(out.tables);
await db.close();
