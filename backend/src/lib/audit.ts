import type { Request } from 'express';
import type { Queryable } from '../db.js';

export async function audit(q: Queryable, req: Request | null, action: string, entity: string, entityId: string | null, metadata: object = {}, actorId?: string) {
  await q.query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorId ?? req?.user?.id ?? null, action, entity, entityId, JSON.stringify(metadata), req?.ip ?? null]);
}
