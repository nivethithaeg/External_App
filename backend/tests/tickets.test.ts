import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env, 'support'); });

const raise = async (c: { auth: any }) => (await request(env.app).post('/api/me/tickets').set(c.auth).send({ subject: 'Refund not received', message: 'Please check my refund' }).expect(201)).body;
const thread = async (id: string) => (await request(env.app).get(`/api/admin/tickets/${id}`).set(admin.auth).expect(200)).body;
const inbox = async (c: { auth: any }) => (await request(env.app).get('/api/me/notifications').set(c.auth).expect(200)).body.notifications as any[];

describe('admin replies on support tickets', () => {
  it('a reply is optional: the admin can just change the status, and the customer is told', async () => {
    const c = await registerUser(env, 'customer');
    const t = await raise(c); const id = t.ticket?.id ?? t.id;
    const before = (await thread(id)).messages.length;
    await request(env.app).post(`/api/admin/tickets/${id}/reply`).set(admin.auth).send({ status: 'resolved' }).expect(201); // no message at all
    const after = await thread(id);
    expect(after.messages).toHaveLength(before); // no empty message was added
    expect(after.ticket.status).toBe('resolved');
    const n = (await inbox(c)).find((x) => x.title === 'Support ticket updated')!;
    expect(n.body).toContain('Refund not received'); expect(n.body).toContain('resolved');
  });
  it('a blank message counts as no message, and a real one is still stored and notified as a reply', async () => {
    const c = await registerUser(env, 'customer');
    const t = await raise(c); const id = t.ticket?.id ?? t.id;
    const before = (await thread(id)).messages.length;
    await request(env.app).post(`/api/admin/tickets/${id}/reply`).set(admin.auth).send({ message: '   ', status: 'in_progress' }).expect(201);
    expect((await thread(id)).messages).toHaveLength(before);
    await request(env.app).post(`/api/admin/tickets/${id}/reply`).set(admin.auth).send({ message: 'Refund is on its way', status: 'in_progress' }).expect(201);
    const after = await thread(id);
    expect(after.messages).toHaveLength(before + 1); expect(after.messages.at(-1).body).toBe('Refund is on its way');
    expect((await inbox(c)).some((x) => x.title === 'Support replied')).toBe(true);
  });
  it('customers must still write a message, and only admins can use the reply endpoint', async () => {
    const c = await registerUser(env, 'customer');
    const t = await raise(c); const id = t.ticket?.id ?? t.id;
    await request(env.app).post(`/api/me/tickets/${id}/messages`).set(c.auth).send({ message: '' }).expect(400);
    await request(env.app).post(`/api/admin/tickets/${id}/reply`).set(c.auth).send({ status: 'closed' }).expect(403);
    await request(env.app).post(`/api/admin/tickets/${id}/reply`).send({ status: 'closed' }).expect(401);
  });
});
