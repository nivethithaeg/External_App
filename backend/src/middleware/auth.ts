import { ownerAreaDays } from '../lib/ownerDay.js';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Ctx, Role } from '../types.js';
import { HttpError, forbidden, unauthorized } from '../errors.js';

export const ADMIN_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['*'],
  operations: ['users', 'venues', 'bookings', 'notifications', 'coupons', 'reports', 'tickets'],
  finance: ['payments', 'refunds', 'payouts', 'settings', 'reports', 'bookings'],
  support: ['tickets', 'bookings', 'users:read'],
};

/** What an admin page or alert can be switched on for, with a label for the picker. */
export const ADMIN_PERMISSION_CATALOGUE: { id: string; label: string }[] = [
  { id: 'venues', label: 'Venue, area and listing approvals, sports' }, { id: 'users', label: 'Users and owners' }, { id: 'bookings', label: 'Bookings' },
  { id: 'notifications', label: 'Broadcast notifications' }, { id: 'coupons', label: 'Coupons' }, { id: 'reports', label: 'Reports and revenue' }, { id: 'tickets', label: 'Support tickets' },
  { id: 'payments', label: 'Payments' }, { id: 'refunds', label: 'Refunds' }, { id: 'payouts', label: 'Owner payouts' }, { id: 'settings', label: 'Commission and settings' },
  { id: 'admins', label: 'Admin team' },
];

/** `custom` is the list ticked for this one admin; without it the role decides. A super admin always has everything. */
export function can(adminRole: string | null, perm: string, custom?: string[] | null): boolean {
  if (!adminRole) return false;
  if (custom && adminRole !== 'super_admin') return custom.includes(perm) || (perm.endsWith(':read') && custom.includes(perm.split(':')[0]));
  const p = ADMIN_PERMISSIONS[adminRole] ?? [];
  return p.includes('*') || p.includes(perm) || (perm.endsWith(':read') ? p.includes(perm.split(':')[0]) : false);
}

export function signToken(ctx: Ctx, user: { id: string; role: string; token_version?: number }, expiresIn?: string) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version ?? 0 }, ctx.cfg.JWT_SECRET, { expiresIn: (expiresIn ?? ctx.cfg.JWT_EXPIRES_IN) as any });
}

export function authenticate(ctx: Ctx) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw unauthorized();
    let payload: any;
    try { payload = jwt.verify(h.slice(7), ctx.cfg.JWT_SECRET); } catch { throw unauthorized('Invalid or expired token'); }
    const { rows } = await ctx.db.query(
      `SELECT id, email, role, admin_role, admin_permissions, full_name, is_active, token_version FROM users WHERE id = $1`, [payload.sub]);
    const u = rows[0];
    if (!u || !u.is_active) throw unauthorized('Account not found or disabled');
    if ((payload.tv ?? 0) !== u.token_version) throw unauthorized('Session expired. Please log in again.');
    req.user = { id: u.id, email: u.email, role: u.role, adminRole: u.admin_role, adminPermissions: u.admin_permissions ?? null, fullName: u.full_name };
    next();
  };
}

/** Like authenticate but does not fail for anonymous requests. */
export function optionalAuth(ctx: Ctx) {
  const auth = authenticate(ctx);
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) return next();
    try { await auth(req, res, () => {}); } catch { /* ignore invalid token on public routes */ }
    next();
  };
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthorized();
  if (!roles.includes(req.user.role)) throw forbidden();
  next();
};

export const requirePermission = (perm: string) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthorized();
  if (req.user.role !== 'admin' || !can(req.user.adminRole, perm, req.user.adminPermissions)) throw forbidden(`Missing permission: ${perm}`);
  next();
};

/**
 * Venue owners can only add and manage venues once KickOff has approved their application. Enforced here on the server for every owner
 * endpoint (paths in `except`, such as the application itself, stay open), so it holds even if someone calls the API directly.
 */
export function requireActiveOwner(ctx: Ctx, except: string[] = []) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (except.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return next(); // looking is always allowed while the application waits; only adding or changing needs approval
    const { rows } = await ctx.db.query('SELECT application_status, verification_status, bank_account_number FROM owner_profiles WHERE user_id=$1', [req.user!.id]);
    const p = rows[0];
    if (!p || p.application_status !== 'approved' || p.verification_status !== 'verified')
      throw new HttpError(403, 'Your owner account must be approved by KickOff before you can add or manage venues. Check your application status.', 'owner_not_approved');
    // approved, but the payout bank account comes first: until it is added only the places that save it work
    if (!p.bank_account_number && !BANK_FIRST_OK.some((x) => req.path === x || req.path.startsWith(x + '/')))
      throw new HttpError(403, 'Add your bank account details first (Account > Bank account). You can use the rest of the portal once they are saved.', 'bank_required');
    // today's opening hours are set but some slots have no price: only the changes that fix it are allowed (as the portal shows)
    const fixing = PRICE_FIRST_OK.some((re) => re.test(`${req.method} ${req.path}`));
    if (fixing) priced.delete(req.user!.id); // prices or hours may change now: check again next time
    if (!fixing && await unpricedToday(ctx, req.user!.id))
      throw new HttpError(403, 'Set the slot prices first: a playing area has slots today with no price. Open Pricing to set them, or change the opening hours.', 'price_required');
    next();
  };
}
/** What still works while today has unpriced slots: prices, hours, closing or editing a playing area, blocking time, profile and bank. */
const PRICE_FIRST_OK = [/^\w+ \/areas\/[^/]+\/(pricing|default-price|date-prices|availability|schedule|price-check|blocks)(\/|$)/, /^PUT \/areas\/[^/]+$/,
  /^\w+ \/venues\/[^/]+\/price-adjustments/, /^\w+ \/blocks/, /^\w+ \/(profile|bank|payment-collection)(\/|$)/];
/** A "no unpriced slots" answer is kept for 30 seconds per owner (the database is far away); a "yes" is checked again every time. */
const priced = new Map<string, number>();
/** Tests change prices straight in the database, so they forget the remembered answers. */
export const forgetPricedCache = () => priced.clear();
async function unpricedToday(ctx: Ctx, ownerId: string): Promise<boolean> {
  if ((priced.get(ownerId) ?? 0) > Date.now()) return false;
  const days = await ownerAreaDays(ctx.db, ownerId, { onlyLive: false, days: [0] });
  const blocked = days.some((d) => d.unpriced > 0);
  if (!blocked) priced.set(ownerId, Date.now() + 30_000); else priced.delete(ownerId);
  return blocked;
}
/** The paths that still work before the bank account is added: the one that saves it. */
const BANK_FIRST_OK = ['/profile', '/bank'];
