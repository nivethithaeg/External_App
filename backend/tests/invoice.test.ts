import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
const paid = async (c: any, day: number) => { const r = await startBooking(env, c, fx, ist(dateIn(day), '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id); return r.booking.body.bookingId as string; };
const inv = (c: any, id: string) => request(env.app).get(`/api/bookings/${id}/invoice`).set(c.auth);

describe('invoice', () => {
  it('is a plain receipt while the owner has no GSTIN', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 20);
    const r = (await inv(c, id).expect(200)).body.invoice;
    expect(r.kind).toBe('receipt'); expect(r.cgst).toBe(0); expect(r.taxable).toBe(r.total);
  });

  it('is a tax invoice with CGST + SGST once the owner has a GSTIN, using the configured rate and SAC', async () => {
    await env.db.query('UPDATE owner_profiles SET gstin=$2 WHERE user_id=$1', [fx.owner.id, '33ABCDE1234F1Z5']);
    await request(env.app).put('/api/admin/settings').set(admin.auth).send({ gstRate: 18, gstSac: '999692' }).expect(200);
    const c = await registerUser(env, 'customer'); const id = await paid(c, 21);
    const r = (await inv(c, id).expect(200)).body.invoice;
    expect(r.kind).toBe('tax_invoice'); expect(r.supplier.gstin).toBe('33ABCDE1234F1Z5'); expect(r.sac).toBe('999692'); expect(r.rate).toBe(18);
    expect(+(r.taxable + r.cgst + r.sgst).toFixed(2)).toBe(r.total);
    expect(Math.abs(r.cgst - r.sgst)).toBeLessThan(0.011);
    expect(r.number).toMatch(/^INV\/\d\d-\d\d\//);
  });

  it('is private to the customer, the owner and admins', async () => {
    const c = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer'); const id = await paid(c, 22);
    await inv(other, id).expect(403);
    await inv(fx.owner, id).expect(200); await inv(admin, id).expect(200);
  });
});
