import type { Queryable } from '../db.js';
export async function getSetting<T>(q: Queryable, key: string, fallback: T): Promise<T> {
  const { rows } = await q.query('SELECT value FROM platform_settings WHERE key=$1', [key]);
  return rows.length ? (rows[0].value as T) : fallback;
}
