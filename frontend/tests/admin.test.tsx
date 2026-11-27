import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const ADMIN = { id: 'a1', email: 'admin@x.co', phone: null, fullName: 'Platform Admin', role: 'admin', adminRole: 'super_admin', emailVerified: true, phoneVerified: false };
const ALERT = { id: 'n1', title: 'Venue submitted for approval', body: 'Arjun Mehta submitted "Green Arena" (Bengaluru) for review.', type: 'admin_venue_submitted', data: { link: '/admin/venues?status=pending' }, read_at: null, created_at: '2030-01-01T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.setItem('playnx_token', 't');
  vi.mocked(api.post).mockResolvedValue({});
  vi.mocked(api.get).mockImplementation(async (url: string) => ({
    '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [ALERT], unread: 1 }, '/admin/venues': { venues: [] },
  } as Record<string, any>)[url] ?? {});
});
const renderAt = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);

describe('admin notifications', () => {
  it('the bell opens the admin inbox, which lists owner-activity alerts with an unread count', async () => {
    renderAt('/admin/venues');
    expect(await screen.findByRole('link', { name: /Notifications, 1 unread/ })).toHaveAttribute('href', '/admin/notifications');
    await userEvent.click(screen.getByRole('link', { name: /Notifications, 1 unread/ }));
    expect(await screen.findByText('Venue submitted for approval')).toBeInTheDocument();
    expect(screen.getByText(/Arjun Mehta submitted "Green Arena"/)).toBeInTheDocument();
  });

  it('clicking an alert marks it read and opens the page it refers to', async () => {
    renderAt('/admin/notifications');
    await userEvent.click(await screen.findByRole('link', { name: /Venue submitted for approval/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/notifications/read', { ids: ['n1'] }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Venue approvals' })).toBeInTheDocument();
  });

  it('keeps broadcast (sending announcements) as a separate page', async () => {
    renderAt('/admin/notify');
    expect(await screen.findByRole('heading', { level: 1, name: 'Broadcast notification' })).toBeInTheDocument();
  });
});


describe('reviewing changes to an approved venue', () => {
  it('shows what is live next to what is proposed, and approves or rejects the changes', async () => {
    const V = { id: 'v1', name: 'Green Arena', city: 'Bengaluru', address: '12 Park Road', status: 'approved', verification_status: 'verified', business_name: 'Mehta Sports', owner_name: 'Arjun', owner_email: 'o@x.co', description: 'Old text' };
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [], unread: 0 },
      '/admin/venues': { venues: [{ ...V, documents: 1, pending_documents: 0, change_pending: true }] },
      '/admin/venues/v1': { venue: V, documents: [], images: [], areas: [], change: { fields: { name: 'Green Arena Pro', cancellation_hours: 12 }, facilities: { from: ['Parking'], to: ['Parking', 'Floodlights'] }, newImages: [{ id: 'i1', url: 'http://x/n.jpg', kind: 'image' }], removedImages: [{ id: 'i2', url: 'http://x/o.jpg', kind: 'image' }], newDocuments: [{ id: 'd1', doc_type: 'Fire safety certificate' }] } },
    } as Record<string, any>)[url] ?? {});
    renderAt('/admin/venues?status=changes');
    await userEvent.click(await screen.findByText('Green Arena'));
    const panel = await screen.findByLabelText('Changes to review');
    expect(panel).toHaveTextContent('Venue name'); expect(panel).toHaveTextContent('Green Arena Pro'); expect(panel).toHaveTextContent('Free-cancellation window'); expect(panel).toHaveTextContent('Floodlights'); expect(within(panel).getByAltText('New photo')).toBeInTheDocument(); expect(within(panel).getByAltText('To be removed')).toBeInTheDocument(); expect(panel).toHaveTextContent('Fire safety certificate');
    await userEvent.click(screen.getByRole('button', { name: 'Approve changes' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/venues/v1/changes', { decision: 'approve', reason: undefined }));
    expect(screen.getByRole('button', { name: 'Reject changes' })).toBeDisabled(); // needs a reason
  });
});

describe('audit log search and coupon performance', () => {
  const setup = (extra: Record<string, any> = {}) => vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => ({
    '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [], unread: 0 }, ...extra,
    '/admin/audit-logs': { logs: params?.q === 'zzz' ? [] : [{ id: 1, created_at: '2030-01-01T10:00:00Z', action: 'venue.discount', entity: 'venue', entity_id: 'v1', actor_name: 'Arjun', metadata: { percent: 20 } }] },
  } as Record<string, any>)[url] ?? {});

  it('searches the audit log as you type, and by date', async () => {
    setup(); renderAt('/admin/audit');
    expect(await screen.findByText('venue.discount')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([u, p]: any) => u === '/admin/audit-logs' && p?.q === 'zzz')).toBe(true));
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search'));
    await userEvent.type(screen.getByLabelText('From'), '2030-01-01');
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([u, p]: any) => u === '/admin/audit-logs' && p?.from === '2030-01-01')).toBe(true));
  });

  it('shows how each coupon performs above the coupon list, and says so when none has been used', async () => {
    setup({ '/admin/coupons': { coupons: [{ id: 'c1', code: 'WELCOME10', discount_type: 'percent', value: 10, is_active: true, valid_to: '2031-01-01T00:00:00Z', used_count: 3, usage_limit: null }] },
      '/admin/coupons/performance': { coupons: [{ id: 'c1', code: 'WELCOME10', venue_name: null, bookings: 3, customers: 2, discount_given: 240, revenue: 2160, used_count: 3 }, { id: 'c2', code: 'UNUSED5', venue_name: 'Green Arena', bookings: 0, customers: 0, discount_given: 0, revenue: 0, used_count: 0 }] } });
    renderAt('/admin/coupons');
    const sec = await screen.findByRole('region', { name: 'Coupon performance' });
    expect(within(sec).getByText('WELCOME10')).toBeInTheDocument(); expect(within(sec).getByText('₹240')).toBeInTheDocument(); expect(within(sec).getByText('₹2,160')).toBeInTheDocument();
    expect(within(sec).queryByText('UNUSED5')).toBeNull(); // unused coupons are left out of the report
  });
});

describe('commission by venue', () => {
  const setup = (extra: Record<string, any>) => vi.mocked(api.get).mockImplementation(async (url: string) => ({ '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [], unread: 0 }, ...extra } as Record<string, any>)[url] ?? {});
  it('the Reports page lists commission per venue', async () => {
    setup({ '/admin/reports/revenue': { rows: [] }, '/admin/reports/commission-by-venue': { rows: [{ id: 'v1', venue: 'Green Arena', owner: 'Mehta Sports', bookings: 12, gross: 9600, commission: 960, effective_rate: 10, owner_earnings: 8640 }] } });
    renderAt('/admin/reports');
    const sec = await screen.findByRole('region', { name: 'Commission by venue' }, { timeout: 5000 });
    expect(await within(sec).findByText('Green Arena', {}, { timeout: 5000 })).toBeInTheDocument(); expect(within(sec).getByText('₹960')).toBeInTheDocument(); expect(within(sec).getByText('10%')).toBeInTheDocument();
    expect(within(sec).getByRole('button', { name: /CSV/ })).toBeInTheDocument();
  });
});

describe('announcements by city', () => {
  const setup = (extra: Record<string, any> = {}) => vi.mocked(api.get).mockImplementation(async (url: string) => ({ '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [], unread: 0 }, '/cities': { cities: [{ city: 'Erode', venues: 1 }, { city: 'Chennai', venues: 3 }] }, ...extra } as Record<string, any>)[url] ?? {});
  it('a broadcast can be aimed at one city, and the confirmation says so', async () => {
    setup(); renderAt('/admin/notify');
    await userEvent.type(await screen.findByLabelText('City (optional)'), 'Erode');
    await userEvent.type(screen.getByLabelText('Title'), 'Weekend offer'); await userEvent.type(screen.getByLabelText('Message'), 'Book now');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(ask).toHaveBeenCalledWith('Send to all in Erode?');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/notifications/broadcast', expect.objectContaining({ audience: 'all', city: 'Erode', title: 'Weekend offer' })));
    ask.mockRestore();
  });
});

describe('approval checklist, venue score and saved rejection reasons', () => {
  const V = { id: 'v1', name: 'Green Arena', city: 'Erode', address: '12 Park Road', status: 'pending', verification_status: 'verified', business_name: 'Mehta Sports', owner_name: 'Arjun', owner_email: 'a@x.co' };
  const CHECK = { auto: [{ id: 'owner_verified', label: 'Owner identity verified', ok: true, detail: 'Owner is verified', required: true }, { id: 'bill', label: 'Electricity bill uploaded', ok: false, detail: 'Missing', required: true }, { id: 'bank', label: 'Bank account added', ok: false, detail: 'Missing', required: false }],
    manual: [{ id: 'photos_match', label: 'The photos show the real venue (not stock images)', checked: false, by: null }, { id: 'docs_legible', label: 'The documents are readable and match the owner and address', checked: true, by: 'Super Admin' }], ready: false, blocking: 2 };
  const setup = (ready = CHECK) => vi.mocked(api.get).mockImplementation(async (url: string) => ({
    '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [], unread: 0 }, '/admin/venues': { venues: [{ ...V, documents: 1, pending_documents: 0 }] },
    '/admin/venues/v1': { venue: V, documents: [], images: [], areas: [], change: null }, '/admin/venues/v1/readiness': { checklist: ready, score: { score: 64, grade: 'Fair', parts: [{ key: 'profile', label: 'Complete profile', points: 20, max: 30, detail: '' }] } },
    '/admin/rejection-templates': { templates: [{ id: 't1', label: 'Photos unclear', body: 'The photos are unclear. Please upload bright, recent photos.' }] },
    '/admin/venue-scores': { scores: {} } } as Record<string, any>)[url] ?? {});
  const open = async () => { renderAt('/admin/venues'); await userEvent.click(await screen.findByText('Green Arena')); return screen.findByRole('region', { name: 'Approval checklist' }); };

  it('lists the checks, marks what failed, lets the admin tick the human ones, and shows the score', async () => {
    setup(); const box = await open();
    expect(within(box).getByText('Electricity bill uploaded')).toBeInTheDocument(); expect(within(box).getByText(/^Failed:/)).toBeInTheDocument(); expect(within(box).getByText('2 to resolve')).toBeInTheDocument();
    expect(within(box).getByText(/^Optional, not done:/)).toBeInTheDocument(); expect(within(box).getByText(/Score 64\/100 · Fair/)).toBeInTheDocument();
    expect(within(box).getByRole('checkbox', { name: /documents are readable/ })).toBeChecked(); expect(within(box).getByText(/ticked by Super Admin/)).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('checkbox', { name: /photos show the real venue/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/venues/v1/review-checks/photos_match', { checked: true }));
  });

  it('asks before approving a venue whose checklist is not complete, and approves without a question when it is', async () => {
    setup(); const box = await open(); void box;
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(ask).toHaveBeenCalledWith('2 approval checks are not complete. Approve anyway?'); expect(api.post).not.toHaveBeenCalledWith('/admin/venues/v1/decision', expect.anything());
    ask.mockReturnValue(true); await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/venues/v1/decision', expect.objectContaining({ decision: 'approve' })));
    ask.mockClear(); vi.mocked(api.post).mockClear();
    setup({ ...CHECK, ready: true, blocking: 0 }); await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/venues/v1/decision', expect.objectContaining({ decision: 'approve' })));
    ask.mockRestore();
  });

  it('fills the reason from a saved one, and saves a typed reason for reuse', async () => {
    setup(); await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Photos unclear' }));
    expect(screen.getByLabelText(/Reason \(required/)).toHaveValue('The photos are unclear. Please upload bright, recent photos.');
    const ask = vi.spyOn(window, 'prompt').mockReturnValue('Unclear photos v2');
    await userEvent.click(screen.getByRole('button', { name: 'Save this reason for reuse' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/rejection-templates', { label: 'Unclear photos v2', body: 'The photos are unclear. Please upload bright, recent photos.' }));
    ask.mockRestore();
  });
});

describe('customer wallet from the admin side', () => {
  it('shows the wallet of a customer and adds credit with a reason', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      '/auth/me': { user: ADMIN }, '/me/notifications': { notifications: [], unread: 0 },
      '/admin/users': { users: [{ id: 'c1', full_name: 'Priya Nair', email: 'p@x.co', role: 'customer', is_active: true, bookings: 2, created_at: '2030-01-01T00:00:00Z' }, { id: 'o1', full_name: 'Arjun', email: 'a@x.co', role: 'owner', is_active: true, bookings: 0, created_at: '2030-01-01T00:00:00Z' }], total: 2 },
      '/admin/users/c1/wallet': { balance: 250, entries: [{ id: 1, delta: 250, kind: 'admin_credit', note: 'Goodwill', created_at: '2030-01-02T10:00:00Z', reference: null, by: 'Super Admin' }] } } as Record<string, any>)[url] ?? {});
    renderAt('/admin/users');
    const wallets = await screen.findAllByRole('button', { name: 'Wallet' }); expect(wallets).toHaveLength(1); // customers only
    await userEvent.click(wallets[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Wallet · Priya Nair' });
    expect(await within(dlg).findByText('₹250')).toBeInTheDocument(); expect(within(dlg).getByText(/by Super Admin/)).toBeInTheDocument();
    const add = within(dlg).getByRole('button', { name: 'Add credit' }); expect(add).toBeDisabled();
    await userEvent.type(within(dlg).getByLabelText('Amount ₹'), '100'); await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Apology for a cancelled game');
    await userEvent.click(add);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/c1/wallet', { amount: 100, reason: 'Apology for a cancelled game' }));
    await userEvent.click(within(dlg).getByRole('radio', { name: 'Remove credit' })); // the form is cleared after a save, so fill it in again
    await userEvent.type(within(dlg).getByLabelText('Amount ₹'), '100'); await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Apology for a cancelled game');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove credit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/c1/wallet', { amount: -100, reason: 'Apology for a cancelled game' }));
  });
});
