import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';

const calls: { method: string; url: string; body?: any; headers?: any }[] = [];
let state: any;
vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  const respond = async (method: string, url: string, body?: any, cfg?: any) => {
    calls.push({ method, url, body, headers: cfg?.headers });
    if (method === 'post' && url === '/auth/jusgo-link') { state = { ...state, status: 'otp_sent', email: body.email, ownerCode: body.ownerCode }; return { data: { token: 'link-secret', signup: state } }; }
    if (url.endsWith('/otp/verify')) { state = { ...state, status: 'pending', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), resendAt: new Date(Date.now() - 1000).toISOString() }; return { data: { signup: state } }; }
    if (url.endsWith('/complete')) return { data: { token: 'session', user: { id: 'u1', role: 'owner' } } };
    if (method === 'get' && url.startsWith('/auth/jusgo-link/')) return { data: { signup: state } };
    return { data: {} };
  };
  return { ...real, get: vi.fn(async () => ({})), post: vi.fn(async () => ({})),
    api: { get: vi.fn((url: string, cfg: any) => respond('get', url, undefined, cfg)), post: vi.fn((url: string, body: any, cfg: any) => respond('post', url, body, cfg)) } };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));

import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const BASE = { id: 's1', status: 'otp_sent', email: '', ownerCode: null, failure: null, otpResendAt: new Date(Date.now() + 60_000).toISOString(), expiresAt: null, resendAt: null, existingAccount: false, profile: null };
const PROFILE = { publicCode: 'JGO-7X9QVZ', name: 'Arun Kumar', email: 'arun@example.com', mobile: '+919876543210', dateOfBirth: '1990-04-01', turfPhone: null,
  address: { line1: '12 Cross Street', line2: null, city: 'Erode', state: 'Tamil Nadu', pincode: '638001' }, business: { accountType: 'INDIVIDUAL', legalName: 'Arun Kumar', gstin: null, address: null, partners: [] },
  panMasked: 'AB•••••4F', aadhaarMasked: 'XXXXXXXX1098', aadhaarVerified: true, verification: 'APPROVED', documents: [{ type: 'AADHAAR_COPY', fileName: 'a.pdf' }] };
const renderAt = (p: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[p]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
beforeEach(() => { calls.length = 0; state = { ...BASE }; sessionStorage.clear(); localStorage.clear(); });

describe('owner sign-up: already registered in JusGo', () => {
  it('email + Owner ID → PlaynX code → approve on JusGo → check the details → account', async () => {
    renderAt('/owner/register');
    await userEvent.click(await screen.findByRole('checkbox', { name: /I'm already registered in JusGo/ }));
    expect(await screen.findByRole('heading', { name: 'Sign up with your JusGo details' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Email registered on JusGo/), 'arun@example.com');
    await userEvent.type(screen.getByLabelText(/JusGo Owner ID/), 'jgo-7x9qvz');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(calls.find((c) => c.url === '/auth/jusgo-link')!.body).toEqual({ email: 'arun@example.com', ownerCode: 'JGO-7X9QVZ' });

    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('6-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(calls.find((c) => c.url.endsWith('/otp/verify'))!.headers).toEqual({ 'X-Link-Token': 'link-secret' });

    expect(await screen.findByText('Approve the request in your JusGo owner portal (or from the email JusGo sent you).')).toBeInTheDocument();
    expect(screen.getByText('Profile → Connected apps')).toBeInTheDocument();
    expect(screen.getByLabelText(/1[45]:\d\d left/)).toBeInTheDocument(); // 15-minute countdown
    expect(screen.getAllByRole('button', { name: 'Sign up normally instead' }).length).toBeGreaterThan(0);

    state = { ...state, status: 'fetched', profile: PROFILE }; // approved on JusGo; the next 3-second check sees it
    expect(await screen.findByRole('heading', { name: 'Check your JusGo details' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('XXXXXXXX1098 (verified on JusGo)')).toBeInTheDocument();
    expect(screen.getByText('AB•••••4F')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Create a PlaynX password/), 'OwnerPass123');
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'OwnerPass123');
    await userEvent.click(screen.getByRole('checkbox', { name: /terms/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create my venue owner account' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/complete'))!.body).toEqual({ password: 'OwnerPass123', acceptTerms: true }));
  }, 15000);

  it('"Sign up normally instead" goes back to the normal form, and a declined request says so', async () => {
    sessionStorage.setItem('playnx_jusgo_link', JSON.stringify({ id: 's1', token: 'link-secret' }));
    state = { ...BASE, status: 'denied', email: 'arun@example.com' };
    renderAt('/owner/register');
    expect(await screen.findByText('The request was declined on JusGo.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign up normally' }));
    expect(await screen.findByRole('heading', { name: 'Register as Venue Owner' })).toBeInTheDocument();
    expect(sessionStorage.getItem('playnx_jusgo_link')).toBeNull();
  });

  it('the JusGo API key is never part of the website code', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|js|html|json)$/.test(f)) files.push(p); } };
    walk(path.resolve(__dirname, '../src'));
    const dist = path.resolve(__dirname, '../dist'); if (fs.existsSync(dist)) walk(dist);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/jsg_(live|test)_/); expect(text, f).not.toMatch(/X-Api-Key/i); expect(text, f).not.toMatch(/JUSGO_API_KEY|JUSGO_WEBHOOK_SECRET|whsec_/);
    }
    for (const k of Object.keys(import.meta.env)) expect(k).not.toMatch(/JUSGO/i); // nothing JusGo is exposed through VITE_ variables
  });
});
