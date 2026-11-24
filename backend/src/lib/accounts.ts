type Q = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/**
 * Owners and admins carry an ID code (VO000123 / AD000001) on their users row. Gives one to an owner or admin that has none yet.
 * Safe to call any time; never throws (a code failure must not break signup or login).
 */
export async function syncAccount(db: Q, userId: string, _opts: { loggedIn?: boolean } = {}): Promise<void> {
  try {
    await db.query(`UPDATE users SET account_code = 'VO' || lpad(nextval('venue_owner_code_seq')::text, 6, '0') WHERE id=$1 AND role='owner' AND account_code IS NULL`, [userId]);
    await db.query(`UPDATE users SET account_code = 'AD' || lpad(nextval('jusgo_admin_code_seq')::text, 6, '0') WHERE id=$1 AND role='admin' AND account_code IS NULL`, [userId]);
  } catch (e) {
    console.error('[accounts] code assignment failed', e);
  }
}
