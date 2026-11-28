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
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.setItem('playnx_token', 't'); calls = []; verifyResult = { valid: true, booking: BOOKING };
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

describe('staff: block slots, customers, event payments', () => {
  const as = (permissions: string[], extra: Record<string, any> = {}) => {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((async (url: string, params?: any) => (url === '/staff/me' ? { business: 'Green Arena Pvt', permissions } : url in extra ? extra[url] : base(url, params))) as any);
  };

  it('shows a tab only for each permission the owner ticked', async () => {
    as(['BLOCK_SLOTS', 'CUSTOMER_VIEW', 'PAYMENT_RECORD'], { '/staff/blocks': { areas: [], blocks: [] } });
    renderAt('/staff/blocks');
    const nav = await screen.findByRole('navigation', { name: 'Staff pages' });
    for (const t of ['Block slots', 'Customers', 'Event payments']) expect(await within(nav).findByRole('link', { name: t })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Check-in' })).toBeNull();
  });

  it('blocks a slot with a reason and opens it again', async () => {
    as(['BLOCK_SLOTS'], { '/staff/blocks': { areas: [{ id: 'a1', name: 'Turf A', venue_name: 'Green Arena' }], blocks: [{ id: 'k1', reason: 'Rain', starts_at: '2030-01-05T10:00:00Z', ends_at: '2030-01-05T11:00:00Z', venue_name: 'Green Arena', area_name: 'Turf A', timezone: 'Asia/Kolkata' }] } });
    vi.mocked(api.post).mockResolvedValue({ block: {} }); vi.mocked(api.del).mockResolvedValue(undefined as any);
    renderAt('/staff/blocks');
    await userEvent.click(await screen.findByRole('button', { name: 'Block slot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the start and end time'); expect(api.post).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('From'), '18:00'); await userEvent.type(screen.getByLabelText('To'), '19:00'); await userEvent.type(screen.getByLabelText('Reason'), 'Maintenance');
    await userEvent.click(screen.getByRole('button', { name: 'Block slot' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/staff/blocks', expect.objectContaining({ areaId: 'a1', reason: 'Maintenance', startsAt: expect.stringMatching(/T18:00:00\+05:30$/), endsAt: expect.stringMatching(/T19:00:00\+05:30$/) })));
    await userEvent.click(screen.getByRole('button', { name: 'Open again' }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/staff/blocks/k1'));
  });

  it('lists customers with a call link and no amounts', async () => {
    as(['CUSTOMER_VIEW'], { '/staff/customers': { customers: [{ name: 'Ravi Kumar', mobile: '+919876543210', city: 'Erode', bookings: 3, last_booking: '2030-01-05T10:00:00Z' }] } });
    renderAt('/staff/customers');
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+919876543210' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it('records a payment for an event, never more than is pending', async () => {
    as(['PAYMENT_RECORD'], { '/staff/event-payments': { events: [{ id: 'e1', title: 'Cup final', name: 'Erode FC', mobile: '+919876500011', venue_name: 'Green Arena', area_name: 'Turf A', starts_at: '2030-01-05T10:00:00Z', total: 3000, paid: 1000, pending: 2000 }] } });
    vi.mocked(api.post).mockResolvedValue({ paid: 3000, pending: 0 });
    renderAt('/staff/payments');
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const amount = screen.getByLabelText('Amount received (₹)'); expect(amount).toHaveValue(2000);
    await userEvent.clear(amount); await userEvent.type(amount, '2500'); await userEvent.selectOptions(screen.getByLabelText('Mode of payment'), 'upi');
    await userEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only ₹2,000 is pending/); expect(api.post).not.toHaveBeenCalled();
    await userEvent.clear(amount); await userEvent.type(amount, '2000');
    await userEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/staff/event-payments/e1', { amount: 2000, mode: 'upi' }));
  });
});
