import pg from 'pg';

export interface QueryResult<T = any> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Db extends Queryable {
  /** Run fn inside a single transaction; rolls back if fn throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Execute a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// numeric -> number (money values are small; 2dp), int8 -> number
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export function createPgDb(connectionString: string, ssl: boolean): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    // the database is far away: opening a connection takes about a second, so keep them open between clicks instead of
    // closing them after 10 idle seconds (the default)
    idleTimeoutMillis: 5 * 60_000, keepAlive: true,
  });
  return {
    async query(text, params) {
      const r = await pool.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q: Queryable = {
          async query(text, params) {
            const r = await client.query(text, params as any[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        };
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) { await pool.query(sql); },
    close: () => pool.end(),
  };
}
