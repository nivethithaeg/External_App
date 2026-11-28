import type { NextFunction, Request, Response } from 'express';
import type { Ctx } from '../types.js';
import { HttpError } from '../errors.js';
import { authenticate } from './auth.js';

/*
 * JusGo's rule (Partner API, "To JusGo"): venue details, playing areas (courts), slots, prices and blocked times are changed only in JusGo by the
 * venue owner, never from a partner app. So once an owner links PlaynX with JusGo (makes a JusGo sync key), PlaynX refuses those changes for that
 * owner and their staff, with code "managed_in_jusgo"; the website shows a pop-up saying to change it in JusGo.
 * Not locked: a new venue, photos, documents, the approval steps, and bookings themselves.
 */

const OWNER_LOCKED: [string, RegExp][] = [
  ['PUT', /^\/venues\/[^/]+(\/(sports|facilities|discount))?$/],
  ['POST', /^\/venues\/[^/]+\/(areas|price-adjustments)$/],
  ['DELETE', /^\/venues\/[^/]+\/price-adjustments\/[^/]+$/],
  ['PUT', /^\/areas\/[^/]+(\/(availability|schedule|pricing|default-price|date-prices))?$/],
  ['DELETE', /^\/areas\/[^/]+(\/date-prices\/[^/]+)?$/],
  ['POST', /^\/areas\/[^/]+\/(deletion|blocks)$/],
  ['POST', /^\/blocks\/bulk$/],
  ['DELETE', /^\/(blocks|weekly-blocks)\/[^/]+$/],
];
const STAFF_LOCKED: [string, RegExp][] = [
  ['POST', /^\/blocks$/],
  ['DELETE', /^\/blocks\/[^/]+$/],
];

export const MANAGED_IN_JUSGO = 'managed_in_jusgo';

export function jusgoLock(ctx: Ctx, side: 'owner' | 'staff') {
  const rules = side === 'owner' ? OWNER_LOCKED : STAFF_LOCKED;
  const auth = authenticate(ctx);
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!rules.some(([m, re]) => m === req.method && re.test(req.path))) return next();
    // the route's own authentication runs again later; here it only tells whose venue this is
    await auth(req, res, async () => {
      const u = req.user!;
      const ownerId = u.role === 'owner' ? u.id
        : u.role === 'staff' ? (await ctx.db.query('SELECT owner_id FROM owner_staff WHERE staff_id=$1', [u.id])).rows[0]?.owner_id : null;
      if (ownerId && (await ctx.db.query('SELECT 1 FROM owner_sync_keys WHERE owner_id=$1', [ownerId])).rows[0]) {
        return next(new HttpError(409, 'This venue is linked with JusGo. Change venue details, playing areas, slots, prices and blocked times in the JusGo owner portal, not here.', MANAGED_IN_JUSGO));
      }
      next();
    });
  };
}
