import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });

describe('Google sign-up on a role-specific page', () => {
  it('does not sign an existing customer into the customer portal from the owner sign-up page', async () => {
    const { email } = await registerUser(env, 'customer');
    const r = await request(env.app).post('/api/auth/google').send({ credential: `good:${email}`, expect: 'owner' }).expect(409);
    expect(r.body.error?.code ?? r.body.code).toBe('role_mismatch');
    expect(r.body.token).toBeUndefined();
    // the normal customer sign-in still works
    await request(env.app).post('/api/auth/google').send({ credential: `good:${email}` }).expect(200);
  });
});
