import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async () => { const a = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api'); return { ...a, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }; });
vi.mock('../src/lib/razorpay', () => ({ openCheckout: vi.fn(), isPaymentNotCompleted: () => false }));
import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import { ThemeProvider } from '../src/lib/theme';
import App from '../src/App';

const STAFF = { id: 'u9', email: 'gate@x.co', phone: null, fullName: 'Gate Keeper', role: 'staff', adminRole: null, emailVerified: true, phoneVerified: false };
const CODE = 'KO-ABC123';
const BOOKING = { reference: 'KO-ABC123', status: 'confirmed', starts_at: '2030-01-05T10:00:00Z', ends_at: '2030-01-05T11:00:00Z', area_name: 'Turf A', venue_name: 'Green Arena', customer_name: 'Priya Nair', checked_in_at: null };
let calls: { method: string; url: string; body?: any }[] = []; let verifyResult: any;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.setItem('kickoff_token', 't'); calls = []; verifyResult = { valid: true, booking: BOOKING };
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ '/auth/me': { user: STAFF }, '/me/notifications': { notifications: [], unread: 0 }, '/staff/me': { business: 'Green Arena Pvt', permissions: ['CHECK_IN', 'BOOKING_VIEW'] }, '/staff/overview': { business: 'Mehta Sports', bookings: [{ id: 'b1', ...BOOKING, timezone: 'Asia/Kolkata' }, { id: 'b2', ...BOOKING, reference: 'KO-2', customer_name: 'Ravi', checked_in_at: '2030-01-05T10:05:00Z', timezone: 'Asia/Kolkata' }] } } as Record<string, any>)[url] ?? {}) as any);
  vi.mocked(api.post).mockImplementation((async (url: string, body?: any) => { calls.push({ method: 'POST', url, body }); if (url === '/staff/verify') return verifyResult; if (url === '/staff/check-in') return { checkedIn: true, alreadyCheckedIn: false, at: '2030-01-05T10:10:00Z', booking: BOOKING }; return {}; }) as any);
});
const renderAt = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></ThemeProvider></QueryClientProvider>);

describe('staff portal', () => {
  it('sends a staff login straight to the check-in screen, with no owner navigation or money', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Check-in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Owner/ })).toBeNull(); expect(screen.queryByText(/Payments|Settlements|Earnings|Bank/)).toBeNull();
    const today = await screen.findByRole('region', { name: "Today's bookings" });
    expect(await within(today).findByText('Priya Nair')).toBeInTheDocument(); expect(within(today).getByText('Expected')).toBeInTheDocument(); expect(within(today).getByText('Checked in')).toBeInTheDocument(); // the list loads after the heading
  });

  it('checks a booking reference, shows who it is for, and checks them in once', async () => {
    renderAt('/staff');
    await userEvent.type(await screen.findByLabelText('Booking reference'), CODE); await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    const res = await screen.findByRole('status', { name: 'Check-in result' });
    expect(res).toHaveTextContent('✓ Valid booking'); expect(res).toHaveTextContent('Priya Nair'); expect(res).toHaveTextContent('Turf A · Green Arena');
    await userEvent.click(within(res).getByRole('button', { name: 'Check player in' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/staff/check-in' && c.body.reference === CODE)).toBe(true));
    expect(await within(await screen.findByRole('status', { name: 'Check-in result' })).findByText(/✓ Checked in at/)).toBeInTheDocument();
  });

  it('says plainly when a booking is not valid, and offers no check-in', async () => {
    verifyResult = { valid: false, booking: { ...BOOKING, status: 'cancelled' } };
    renderAt('/staff');
    await userEvent.type(await screen.findByLabelText('Booking reference'), CODE); await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    const res = await screen.findByRole('status', { name: 'Check-in result' }); expect(res).toHaveTextContent('✗ Not valid for entry'); expect(within(res).queryByRole('button', { name: 'Check player in' })).toBeNull();
  });

  it('asks before logging out', async () => {
    renderAt('/staff'); await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('dialog', { name: 'Log out?' })).toBeInTheDocument();
  });
});
