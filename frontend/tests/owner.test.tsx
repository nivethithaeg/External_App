import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/razorpay', () => ({ openCheckout: vi.fn(), isPaymentNotCompleted: (e: any) => e?.name === 'PaymentNotCompleted' }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const OWNER = { id: 'o1', email: 'owner@x.co', phone: null, fullName: 'Arjun Mehta', role: 'owner', adminRole: null, emailVerified: true, phoneVerified: false };
const AREA = { id: 'a1', name: 'Turf A', venue_id: 'v1', venue_name: 'Green Arena', sports: ['Football'], min_price: 800, max_price: 1200, open_days: 7, bookings: 3, is_active: true, surface: 'Grass', capacity: 14 };
const BOOKING = { id: 'b1', reference: 'KO-ABC1234', status: 'confirmed', customer_name: 'Ravi Kumar', customer_email: 'r@x.co', customer_phone: '+919800000000', venue_name: 'Green Arena', area_name: 'Turf A', sport: 'Football',
  starts_at: '2030-01-01T12:30:00Z', ends_at: '2030-01-01T13:30:00Z', timezone: 'Asia/Kolkata', subtotal: 1200, discount: 100, total: 1100, owner_amount: 990, commission_amount: 110, payment_status: 'captured', created_at: '2029-12-30T10:00:00Z', refunded: 0 };
const OVERVIEW = {
  counts: { venues: 2, active_venues: 1, areas: 3 }, today: { bookings: 4, revenue: 3600 }, month: { bookings: 20, revenue: 18000 }, upcoming: 7, awaitingPayment: 1,
  slots: { total: 30, booked: 12, available: 18, occupancyPct: 40 }, slotsToday: { open: 17, total: 30 }, statusBreakdown: [{ status: 'confirmed', n: 5 }, { status: 'cancelled', n: 1 }],
  schedule: [{ id: 'b1', status: 'confirmed', customer_name: 'Ravi Kumar', venue_name: 'Green Arena', area_name: 'Turf A', sport: 'Football', starts_at: BOOKING.starts_at, ends_at: BOOKING.ends_at, timezone: 'Asia/Kolkata' }],
  nextBookings: [], popularAreas: [{ id: 'a1', name: 'Turf A', venue_name: 'Green Arena', bookings: 9, revenue: 8100 }], recentTransactions: [{ id: 'p1', amount: 1100, status: 'captured', at: '2029-12-30T10:00:00Z', reference: 'KO-ABC1234' }],
  venues: [{ id: 'v1', name: 'Green Arena', city: 'Bengaluru', status: 'approved' }, { id: 'v2', name: 'Draft Turf', city: 'Pune', status: 'pending' }],
  revenue: { day: [{ period: '2029-12-30', revenue: 990, bookings: 1 }], week: [], month: [], year: [] },
};
const VENUE = { id: 'v1', name: 'Green Arena', city: 'Bengaluru', status: 'approved', area_count: 1, images: [], facilityIds: [], documents: [], address: 'x', lat: 1, lng: 1, cancellation_hours: 24,
  areas: [{ id: 'a1', name: 'Turf A', is_active: true, sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 180, pricing: [{ id: 'p', sportId: null, dayType: 'all', startTime: '06:00', endTime: '23:00', pricePerHour: 800 }], availability: [{ dayOfWeek: 1, openTime: '06:00', closeTime: '23:00', isClosed: false }] }] };

const ACTIVE_APP = { accountStatus: 'active', application: { reference: 'KOA-20300101-ABC123', status: 'approved', editable: false }, contact: { emailVerified: true }, business: {}, identity: {}, documents: [], requiredDocs: [], venues: [], sections: {}, missing: [], correction: null, events: [] };
let calls: [string, any][] = [];
let routes_override: Record<string, any> = {};
function mockApi(overrides: Record<string, any> = {}) {
  vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => {
    calls.push([url, params]);
    if (url in routes_override) return routes_override[url]; // set by a test after setup
    if (url in overrides) return overrides[url];
    const table: Record<string, any> = {
      '/auth/me': { user: OWNER }, '/owner/application': ACTIVE_APP, '/me/notifications': { notifications: [], unread: 2 }, '/owner/overview': OVERVIEW,
      '/owner/dashboard': { verification: 'verified' }, '/owner/venues': { venues: [VENUE] }, '/owner/venues/v1': { venue: VENUE }, '/owner/areas': { areas: [AREA] },
      '/owner/documents': { documents: [{ id: 'd1', doc_type: 'Lease deed', status: 'rejected', note: 'Blurry scan', venue_name: 'Green Arena', url: 'https://x/d.pdf', created_at: '2029-01-01T00:00:00Z' }] },
      '/owner/calendar': { items: [] }, '/owner/blocks': { blocks: [] }, '/owner/bookings': { bookings: [BOOKING], total: 41 }, '/owner/payout-status': { holdHours: 48, totals: { gross: 0, fee: 0, on_hold: 0, ready_to_pay: 0, dispute: 0 }, bookings: [] }, '/owner/transactions': { transactions: [], total: 0 }, '/owner/staff': { staff: [], max: 10, permissions: [{ id: 'CHECK_IN', label: 'Check players in', hint: 'x' }, { id: 'BOOKING_VIEW', label: 'View bookings', hint: 'y' }] },
      '/owner/settlements': { summary: { totalEarnings: 5000, completed: 1000, pending: 500, available: 3500 }, payouts: [], bank: { accountName: 'Mehta', accountNumber: '••••••••9012', ifsc: 'HDFC0001234', verified: false } },
      '/owner/refunds': { refunds: [] }, '/owner/customers': { customers: [], summary: { customers: 0, repeat: 0, bookings: 0, cancellations: 0 } }, '/owner/activity': { activity: [], categories: [] }, '/owner/pending-payments': { customers: [], totalPending: 0 },
      '/owner/bank': { accountName: 'Mehta', accountNumber: '••••••••9012', ifsc: 'HDFC0001234', upi: null, verified: true }, '/owner/pricing/history': { history: [] }, '/owner/security/login-history': { events: [{ action: 'user.login', ip: '1.2.3.4', created_at: '2030-01-01T00:00:00Z' }] }, '/owner/account/close-info': { reasons: ['Other'] },
      '/owner/venues/v1/price-adjustments': { adjustments: [{ id: 'pa1', label: 'Pongal holiday', start_date: '2030-01-14', end_date: '2030-01-16', percent: 20 }] },
      '/owner/analytics': { summary: { total: 5, confirmed: 3, completed: 1, cancelled: 1, pending: 0, gross: 6000, net: 5400, avg_value: 1200, occupancyPct: 33.3 }, trend: [{ period: '2029-12-30', bookings: 1, revenue: 990 }], byVenue: [{ name: 'Green Arena', bookings: 4, revenue: 5400 }], byArea: [], bySport: [], peakHours: [{ hour: 18, bookings: 3 }] },
      '/me/profile': { user: OWNER, profile: { business_name: 'Mehta Sports', verification_status: 'verified', bank_account_number: '••••••••9012', bank_ifsc: 'HDFC0001234', bank_verified: false } },
      '/owner/coupons': { coupons: [] }, '/owner/reviews': { reviews: [] }, '/me/tickets': { tickets: [] }, '/sports': { sports: [{ id: 1, name: 'Football', slug: 'football' }] }, '/facilities': { facilities: [] },
    };
    return table[url] ?? {};
  });
}
const renderAt = (path: string, user: any = OWNER) => {
  if (user) sessionStorage.setItem('kickoff_token', 't');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
};
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); calls = []; routes_override = {}; mockApi(); });

const PAGES: [string, RegExp][] = [
  ['/owner', /^Good (morning|afternoon|evening),/], ['/owner/venues', /Your venues/], ['/owner/areas', /^Playing areas$/], ['/owner/hours', /Operating hours/],
  ['/owner/calendar', /Calendar/], ['/owner/slots', /Slot management/], ['/owner/blocked', /Blocked slots/], ['/owner/bookings', /^Bookings$/], ['/owner/bookings/new', /Add offline booking/], ['/owner/bookings/upcoming', /Upcoming bookings/],
  ['/owner/bookings/history', /Booking history/], ['/owner/bookings/cancelled', /Cancelled bookings/], ['/owner/pricing', /Pricing & rates/], ['/owner/offers', /^Offers$/], ['/owner/reports', /^Report & Payments$/],
  ['/owner/payments', /^Report & Payments$/], ['/owner/refunds', /^Report & Payments$/], ['/owner/notifications', /^Notifications$/], ['/owner/support', /^Admin Support$/],
  ['/owner/announcements', /^Announcements$/], ['/owner/reviews', /^Reviews$/], ['/owner/account/staff', /^Staff$/], ['/owner/account/profile', /^Profile$/], ['/owner/account/payouts', /^Payouts$/], ['/owner/account/business', /Business information/], ['/owner/account/bank', /Bank account details/],
  ['/owner/account/security', /^Settings$/], ['/owner/customers', /^Customers$/], ['/owner/pending-payments', /^Report & Payments$/], ['/owner/activity', /^Activity Log$/], ['/owner/delete-account', /^Delete account$/],
];

describe('availability calendar', () => {
  // a month calendar: pick a date and see what happened that day
  const ist = (offset = 0) => { const d = new Date(Date.now() + offset * 86400000); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); };
  const pretty = (d: string, year = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const item = (id: string, day: string, hhmm: string, over: any = {}) => ({ id, area_id: 'a1', area_name: 'Turf A', venue_name: 'Green Arena', status: 'confirmed', sport: 'Cricket', customer_name: 'Guest', starts_at: `${day}T${hhmm}:00+05:30`, ends_at: `${day}T${String(+hhmm.slice(0, 2) + 1).padStart(2, '0')}:${hhmm.slice(3)}:00+05:30`, reference: `KO-${id}`, total: 400, ...over });
  const withItems = () => { routes_override['/owner/calendar'] = { items: [item('b1', ist(), '12:30', { customer_name: 'Today Guest' }), item('b2', ist(1), '10:00', { customer_name: 'Tomorrow Guest' }), item('b3', ist(1), '15:00', { status: 'blocked', block_kind: 'blocked', customer_name: null, notes: 'Private event' })] }; };

  it('shows a month calendar with today selected, and no Day / Week / Month switch', async () => {
    withItems(); renderAt('/owner/calendar');
    const cal = await screen.findByRole('region', { name: 'Calendar' });
    expect(within(cal).getByRole('heading', { level: 2 })).toHaveTextContent(new Date(`${ist().slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
    expect(within(cal).getByRole('button', { name: new RegExp(`${pretty(ist())}: .*\\(today\\)`) })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { level: 2, name: `Today · ${pretty(ist(), true)}` })).toBeInTheDocument();
    for (const t of ['Day', 'Week', 'Month']) expect(screen.queryByRole('tab', { name: t })).toBeNull();
    expect(within(cal).getAllByRole('button', { name: /: (no bookings|\d+ bookings?)/ })).toHaveLength(42); // six weeks, so every date of the month is on it
  });

  it('the calendar is a compact date picker in a side panel, with the slot grid and bookings outside it', async () => {
    withItems(); renderAt('/owner/calendar');
    const side = await screen.findByRole('complementary', { name: 'Pick a date' });
    expect(within(side).getByRole('region', { name: 'Calendar' })).toBeInTheDocument();
    const list = await screen.findByRole('region', { name: 'Bookings today' });
    expect(side.contains(list)).toBe(false);
  });

  it('free slots can be selected one by one or several in a row, then blocked together', async () => {
    withItems(); renderAt('/owner/calendar');
    await userEvent.click(await screen.findByRole('button', { name: 'Turf A 6:00 available' }));
    expect(await screen.findByText('1 slot selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turf A 8:00 available' }));
    expect(screen.getByText('3 slots selected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Block selected' })).toHaveAttribute('href', expect.stringContaining('hour=6&to=9'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('3 slots selected')).toBeNull();
  });

  it('every date shows how many bookings happened that day, and how many slots were blocked', async () => {
    withItems(); renderAt('/owner/calendar');
    const cal = await screen.findByRole('region', { name: 'Calendar' });
    expect(await within(cal).findByRole('button', { name: new RegExp(`${pretty(ist())}: 1 booking \\(today\\)`) })).toBeInTheDocument();
    expect(within(cal).getByRole('button', { name: `${pretty(ist(1))}: 1 booking, 1 blocked` })).toBeInTheDocument();
    expect(within(cal).getByRole('button', { name: `${pretty(ist(2))}: no bookings` })).toBeInTheDocument();
  });

  it('picking a date shows the bookings and slots of that day only, and Today brings back today\'s', async () => {
    withItems(); renderAt('/owner/calendar');
    const cal = await screen.findByRole('region', { name: 'Calendar' });
    expect(await within(await screen.findByRole('region', { name: 'Bookings today' })).findByText('Today Guest')).toBeInTheDocument();
    await userEvent.click(within(cal).getByRole('button', { name: `${pretty(ist(1))}: 1 booking, 1 blocked` }));
    expect(await screen.findByRole('heading', { level: 2, name: pretty(ist(1), true) })).toBeInTheDocument(); // no "Today ·" any more
    const list = screen.getByRole('region', { name: 'Bookings on this day' });
    expect(within(list).getByText('Tomorrow Guest')).toBeInTheDocument(); expect(within(list).getByText('Private event')).toBeInTheDocument(); expect(within(list).queryByText('Today Guest')).toBeNull();
    expect(screen.getByRole('button', { name: /Turf A 10:00 Booked, Tomorrow Guest/ })).toBeInTheDocument(); // the slot grid is for the picked day too
    expect(screen.queryByRole('button', { name: /Turf A 12:00 Booked/ })).toBeNull();
    await userEvent.click(within(cal).getByRole('button', { name: `${pretty(ist(2))}: no bookings` }));
    expect(await screen.findByText('Nothing booked or blocked on this day.')).toBeInTheDocument();
    await userEvent.click(within(cal).getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { level: 2, name: `Today · ${pretty(ist(), true)}` })).toBeInTheDocument(); expect(within(screen.getByRole('region', { name: 'Bookings today' })).getByText('Today Guest')).toBeInTheDocument();
  });

  it('the month arrows move through the months, selecting the 1st (or today in the current month)', async () => {
    withItems(); renderAt('/owner/calendar');
    const cal = await screen.findByRole('region', { name: 'Calendar' });
    const title = () => within(cal).getByRole('heading', { level: 2 }).textContent;
    const first = title();
    await userEvent.click(within(cal).getByRole('button', { name: 'Next month' }));
    expect(title()).not.toBe(first);
    expect(await screen.findByRole('heading', { level: 2, name: /^\w+, 1 \w+ \d{4}$/ })).toBeInTheDocument(); // the 1st of that month is picked
    await userEvent.click(within(cal).getByRole('button', { name: 'Previous month' }));
    expect(title()).toBe(first); expect(await screen.findByRole('heading', { level: 2, name: `Today · ${pretty(ist(), true)}` })).toBeInTheDocument();
  });

  it('clicking a greyed-out date from the next month moves the calendar to that month', async () => {
    withItems(); renderAt('/owner/calendar');
    const cal = await screen.findByRole('region', { name: 'Calendar' });
    const first = within(cal).getByRole('heading', { level: 2 }).textContent;
    const last = within(cal).getAllByRole('button', { name: /: (no bookings|\d+ bookings?)/ }).at(-1)!; // the last cell is always in the following month
    await userEvent.click(last);
    expect(within(cal).getByRole('heading', { level: 2 }).textContent).not.toBe(first); expect(last).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows today\'s slots, with the full customer name, time and area for each booking, not just a shortened cell', async () => {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    routes_override['/owner/calendar'] = { items: [{ id: 'b9', area_id: 'a1', area_name: 'Turf A', venue_name: 'Green Arena', status: 'confirmed', sport: 'Cricket', customer_name: 'Googleson Raghavendran', starts_at: `${day}T12:30:00+05:30`, ends_at: `${day}T13:00:00+05:30`, reference: 'KO-1', total: 400 }] };
    renderAt('/owner/calendar');
    const list = await screen.findByRole('region', { name: 'Bookings today' });
    expect(within(list).getByText('Googleson Raghavendran')).toBeInTheDocument();
    expect(list).toHaveTextContent(/12:30 pm to 1:00 pm/i); expect(list).toHaveTextContent('Turf A'); expect(list).toHaveTextContent('Cricket');
    expect(screen.getByRole('button', { name: /Turf A 12:00 Booked, Googleson Raghavendran/ })).toHaveAttribute('title', expect.stringContaining('Googleson Raghavendran'));
  });
});

describe('special-date pricing', () => {
  it('lists the special dates of the venue and adds a new one', async () => {
    const { unmount } = renderAt('/owner/pricing');
    expect(await screen.findByText('Pongal holiday')).toBeInTheDocument(); expect(screen.getByText('+20%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    expect(await screen.findByText(/Give it a name/)).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Name'), 'Diwali'); await userEvent.type(screen.getByLabelText('Date'), '2030-11-01'); await userEvent.type(screen.getByLabelText('Change %'), '-10');
    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/venues/v1/price-adjustments', { label: 'Diwali', startDate: '2030-11-01', endDate: '2030-11-01', percent: -10 }));
    unmount();
  });
});

describe('owner portal navigation', () => {
  it('sidebar contains every menu group and each link points at a page that renders', async () => {
    const { container, unmount } = renderAt('/owner');
    await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening),/ });
    const side = screen.getAllByRole('navigation', { name: /Turf Owner Portal navigation/i })[0];
    for (const g of ['Venue management', 'Scheduling', 'Booking management', 'Business management', 'Communication', 'Account']) expect(within(side).getByText(g)).toBeInTheDocument();
    for (const b of within(side).getAllByRole('button', { expanded: false })) await userEvent.click(b); // open every dropdown
    const hrefs = [...side.querySelectorAll('a')].map((a) => a.getAttribute('href')!);
    expect(hrefs.length).toBeGreaterThanOrEqual(26);
    expect(new Set(hrefs)).toEqual(new Set(PAGES.map(([p]) => p).filter((p) => (p !== '/owner/reviews' || hrefs.includes(p)) && !['/owner/payments', '/owner/refunds', '/owner/pending-payments'].includes(p)))); // those three are tabs of Report & Payments now
    unmount(); void container;
  });

  for (const [path, title] of PAGES) {
    it(`${path} renders its page without errors`, async () => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(screen.queryByText(/out of bounds/)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // no error boxes with healthy API
    });
  }

  it('asks before logging out of the owner portal, and only ends the session when confirmed', async () => {
    renderAt('/owner/bookings/upcoming');
    await userEvent.click(await screen.findByRole('button', { name: /Arjun Mehta/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    const dlg = await screen.findByRole('dialog', { name: 'Log out?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Stay logged in' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log out?' })).toBeNull());
    expect(sessionStorage.getItem('kickoff_token')).toBe('t'); // still signed in
    await userEvent.click(screen.getByRole('button', { name: /Arjun Mehta/ })); await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Log out?' })).getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(sessionStorage.getItem('kickoff_token')).toBeNull());
  });

  it('the owner adds staff logins, switches one off, and removes one', async () => {
    routes_override['/owner/staff'] = { max: 10, permissions: [{ id: 'CHECK_IN', label: 'Check players in', hint: 'x' }, { id: 'BOOKING_VIEW', label: 'View bookings', hint: 'y' }], staff: [{ id: 's1', full_name: 'Gate Keeper', email: 'gate@x.co', is_active: true, last_login: null, check_ins: 3, permissions: ['CHECK_IN'] }] };
    renderAt('/owner/account/staff');
    expect(await screen.findByRole('heading', { level: 1, name: 'Staff' })).toBeInTheDocument();
    expect(await screen.findByText('Gate Keeper')).toBeInTheDocument(); expect(screen.getByText(/Has not signed in yet · 3 check-ins/)).toBeInTheDocument(); expect(screen.getByText('1 of 10 staff logins used.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); // name, email, a 10-character password and the same password again are needed
    await userEvent.type(screen.getByLabelText(/^Staff Name/), 'Ravi Kumar'); await userEvent.type(screen.getByLabelText(/^Email/), 'ravi@x.co'); await userEvent.type(screen.getByLabelText(/^Password/), 'GatePass#2026');
    await userEvent.type(screen.getByLabelText(/^Confirm Password/), 'Other#2026'); expect(screen.getByText('Passwords do not match')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/^Confirm Password/)); await userEvent.type(screen.getByLabelText(/^Confirm Password/), 'GatePass#2026');
    expect(screen.getByRole('switch', { name: 'Active' })).toBeChecked(); expect(screen.getByRole('switch', { name: 'All venues' })).toBeChecked(); // Venue access: every venue unless some are chosen
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/staff', { fullName: 'Ravi Kumar', email: 'ravi@x.co', password: 'GatePass#2026', isActive: true, permissions: ['CHECK_IN', 'BOOKING_VIEW'], allVenues: true, venueIds: [] }));
    expect(screen.getByLabelText('Search staff (optional)')).toBeInTheDocument(); expect(screen.getByLabelText('Status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/owner/staff/s1', { isActive: false }));
    window.confirm = () => true; await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/owner/staff/s1'));
  });

  it('the playing areas page has no venue score card', async () => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, status: 'approved' } };
    renderAt('/owner/areas');
    expect(await screen.findByRole('button', { name: '+ Add area' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Venue score' })).toBeNull();
  });

  it('Payments shows when each booking is released to the owner, and offers a monthly statement', async () => {
    routes_override['/owner/transactions'] = { total: 2, transactions: [
      { id: 'p1', transaction_id: '…abc', reference: 'KO-1', customer_name: 'Priya', venue_name: 'Green Arena', subtotal: 800, discount: 0, commission_amount: 80, owner_amount: 720, amount: 800, status: 'captured', method: 'upi', paid_at: '2030-01-01T10:00:00Z', release_state: 'holding', release_at: '2030-01-04T10:00:00Z', refunded: 0 },
      { id: 'p2', transaction_id: '…def', reference: 'KO-2', customer_name: 'Ravi', venue_name: 'Green Arena', subtotal: 800, discount: 0, commission_amount: 80, owner_amount: 720, amount: 800, status: 'captured', method: 'upi', paid_at: '2030-01-01T11:00:00Z', release_state: 'complaint', release_at: '2030-01-04T11:00:00Z', refunded: 0 }] };
    renderAt('/owner/payments');
    expect(await screen.findByText('On hold until')).toBeInTheDocument(); expect(screen.getByText('Dispute: complaint')).toBeInTheDocument();
    const boxes = screen.getByRole('region', { name: 'Your balance' });
    expect([...boxes.querySelectorAll('p.uppercase')].map((x) => x.textContent)).toEqual(['Gross value', 'On hold', 'Ready to pay', 'Dispute', 'Paid to your bank']);
    const stmt = screen.getByRole('region', { name: 'Monthly statement' });
    expect(within(stmt).getByLabelText('Month')).toBeInTheDocument(); expect(within(stmt).getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it('the Overview shows what is left before the venue can go live, linking each open step, and hides once everything is done', async () => {
    routes_override['/owner/checklist'] = { venue: { name: 'Green Arena' }, done: 2, total: 4, complete: false, items: [
      { id: 'verified', label: 'Business details verified by KickOff', done: true, link: '/owner/account/business' }, { id: 'bank', label: 'Bank account added for payouts', done: true, link: '/owner/account/bank' },
      { id: 'photos', label: 'Add venue photos', done: false, link: '/owner/venues/v1' }, { id: 'area', label: 'Add a playing area with its sports', done: false, link: '/owner/areas' }] };
    renderAt('/owner');
    const box = await screen.findByRole('region', { name: 'Go-live checklist' });
    expect(within(box).getByText('2 of 4 steps done. Customers can book once the venue is approved.')).toBeInTheDocument(); expect(within(box).getByText('50%')).toBeInTheDocument();
    expect(within(box).getByRole('progressbar', { name: 'Checklist progress' })).toHaveAttribute('aria-valuenow', '2');
    expect(within(box).getByRole('link', { name: /Add venue photos/ })).toHaveAttribute('href', '/owner/venues/v1');
    expect(within(box).queryByRole('link', { name: /Bank account added/ })).toBeNull(); // done steps are not links
  });
  it('no checklist once the venue is fully live', async () => {
    routes_override['/owner/checklist'] = { venue: { name: 'Green Arena' }, done: 2, total: 2, complete: true, items: [{ id: 'a', label: 'x', done: true, link: '/' }, { id: 'b', label: 'y', done: true, link: '/' }] };
    renderAt('/owner'); await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening),/ });
    expect(screen.queryByRole('region', { name: 'Go-live checklist' })).toBeNull();
  });
  it('Reports shows repeat customers: how many came back and who the best ones are', async () => {
    routes_override['/owner/reports/customers'] = { customers: 5, repeatCustomers: 2, repeatRate: 40, avgBookings: 1.8, top: [{ customer_id: 'c1', full_name: 'Priya Nair', bookings: 4, spend: 3200 }] };
    renderAt('/owner/reports');
    const box = await screen.findByRole('region', { name: 'Repeat customers' });
    expect(within(box).getByText('40%')).toBeInTheDocument(); expect(within(box).getByText('Priya Nair')).toBeInTheDocument(); expect(within(box).getByText('₹3,200')).toBeInTheDocument();
  });

  it('the owner sidebar has the animated indicator and a collapse button that shows every page as an icon', async () => {
    renderAt('/owner/venues');
    const nav = await screen.findByRole('navigation', { name: /Owner/ });
    expect(nav.querySelectorAll('span.bg-brand')).toHaveLength(1); // one shared orange indicator, not one per item
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('link', { name: /Playing areas/ })).toBeInTheDocument(); // collapsed: items are listed flat, without opening groups
    expect(localStorage.getItem('kickoff_owner_side')).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  });

  it('shows breadcrumbs, notification unread count and the profile menu with logout', async () => {
    renderAt('/owner/bookings/upcoming');
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Booking management')).toBeInTheDocument();
    expect(within(crumbs).getByText('Upcoming bookings')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByLabelText(/Notifications, 2 unread/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Arjun Mehta/ }));
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Security settings' })).toHaveAttribute('href', '/owner/account/security');
  });

  it('sidebar sections are dropdowns: the current section is open, others collapsed until clicked', async () => {
    renderAt('/owner/bookings/history');
    await screen.findByRole('heading', { level: 1, name: 'Booking history' });
    const side = screen.getAllByRole('navigation', { name: /Turf Owner Portal navigation/i })[0];
    const bookings = within(side).getByRole('button', { name: 'Booking management' });
    expect(bookings).toHaveAttribute('aria-expanded', 'true');
    expect(within(side).getByRole('link', { name: /Booking history/ })).toHaveAttribute('aria-current', 'page');
    const sched = within(side).getByRole('button', { name: 'Scheduling' });
    expect(sched).toHaveAttribute('aria-expanded', 'false');
    expect(within(side).queryByRole('link', { name: /Calendar/ })).not.toBeInTheDocument();
    await userEvent.click(sched);
    expect(within(side).getByRole('link', { name: /Calendar/ })).toBeInTheDocument();
    await userEvent.click(sched);
    expect(within(side).queryByRole('link', { name: /Calendar/ })).not.toBeInTheDocument();
    expect(within(side).getByRole('link', { name: 'Overview' })).toBeInTheDocument(); // single-item section stays a plain link
  });

  it('mobile drawer opens from the menu button and closes', async () => {
    renderAt('/owner');
    await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening),/ });
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dlg = screen.getByRole('dialog', { name: 'Navigation menu' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Scheduling' }));
    expect(within(dlg).getByRole('link', { name: /Calendar/ })).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument();
  });

  it('keeps customers and anonymous visitors out', async () => {
    localStorage.clear(); sessionStorage.clear();
    renderAt('/owner', null);
    expect(await screen.findByRole('heading', { name: /Welcome back/ })).toBeInTheDocument(); // sent to owner login
  });
});

describe('venue form location', () => {
  it('uses a State dropdown followed by a City dropdown limited to that state', async () => {
    renderAt('/owner/venues/new');
    const state = await screen.findByLabelText('State');
    expect(screen.getByLabelText('City')).toBeDisabled();
    await userEvent.selectOptions(state, 'Maharashtra');
    const cities = within(screen.getByLabelText('City')).getAllByRole('option').map((x) => x.textContent);
    expect(cities).toEqual(expect.arrayContaining(['Mumbai', 'Pune'])); expect(cities).not.toContain('Bengaluru');
    for (const l of ['State', 'City', 'Venue name', 'Address line 1']) expect(screen.getByText(l)).toHaveClass("after:content-['*']");
  });
});

describe('venue page layout and status', () => {
  const draft = (over: any = {}) => { routes_override['/owner/venues/v1'] = { venue: { ...VENUE, status: 'draft', state: 'Tamil Nadu', city: 'Erode', rejection_reason: null, areas: [], ...over } }; };
  it('has the JusGo tabs (360° View, Playing areas, Edit venue) and the Edit venue tab holds the whole form', async () => {
    draft(); renderAt('/owner/venues/v1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Green Arena' })).toBeInTheDocument();
    for (const t of ['360° View', 'Playing areas', 'Edit venue']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '360° Venue View' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Edit venue' }));
    await screen.findByRole('heading', { level: 2, name: 'Venue details' });
    for (const t of ['Venue details', 'Address', 'Facilities', 'Photos & video', 'Documents']) expect(screen.getByRole('heading', { level: 2, name: t })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /playing area/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Venue name')).toHaveValue('Green Arena'); // the saved data is filled in
    expect(screen.queryByRole('heading', { name: 'Submit for approval' })).not.toBeInTheDocument(); // the old panel is gone
    expect(screen.queryByRole('link', { name: /^Go to / })).not.toBeInTheDocument();
  });
  it('explains what Not published means, in plain words, right at the top', async () => {
    draft(); renderAt('/owner/venues/v1?tab=edit');
    await screen.findByRole('heading', { level: 1, name: 'Green Arena' });
    const note = screen.getAllByRole('status').find((el) => el.textContent?.includes('Not published:'))!;
    expect(note).toHaveTextContent(/only you can see it/i); expect(note).toHaveTextContent(/Send for approval/i);
    expect(screen.getByText('Erode, Tamil Nadu')).toBeInTheDocument();
  });
  it('explains the other statuses and shows the rejection reason', async () => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, status: 'rejected', rejection_reason: 'Photos are unclear' } };
    renderAt('/owner/venues/v1?tab=edit');
    expect(await screen.findByText(/Needs changes:/)).toBeInTheDocument();
    expect(screen.getByText(/Photos are unclear/)).toBeInTheDocument();
  });
  it('submitting from this page explains what is missing instead of sending anything', async () => {
    draft({ images: [], documents: [] }); renderAt('/owner/venues/v1?tab=edit');
    await userEvent.click(await screen.findByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText('Add at least one photo')).toBeInTheDocument(); expect(screen.getByText('Upload the electricity bill')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('the Playing areas, Pricing and Hours pages are read-only while a venue is under approval', async () => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, status: 'pending' } };
    renderAt('/owner/areas');
    expect(await screen.findByText(/can't be changed until it is reviewed/)).toBeInTheDocument();
    const locked = screen.getByRole('group', { name: 'Locked while under approval' });
    expect(locked).toBeDisabled();
    for (const b of within(locked).queryAllByRole('button')) expect(b).toBeDisabled();
  });
  it('Playing areas has just the venue dropdown (no venue card), and the Add area form still shows which venue it is for', async () => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, images: [{ id: 'i1', url: 'http://x/cover.jpg', kind: 'image', is_cover: true }, { id: 'i2', url: 'http://x/b.jpg', kind: 'image', is_cover: false }] } };
    renderAt('/owner/areas');
    expect(await screen.findByLabelText('Create playing areas for venue')).toHaveValue('v1'); // picker is there with one venue
    expect(screen.queryByLabelText('Venue')).not.toBeInTheDocument(); // no venue card under it
    await userEvent.click(screen.getByRole('button', { name: '+ Add area' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/created under the venue above/)).toBeInTheDocument();
    expect(within(dialog).getByText('Green Arena')).toBeInTheDocument(); expect(within(dialog).getAllByRole('img').length).toBeGreaterThan(0);
  });
  it.each([['pending', 'Waiting for approval'], ['draft', 'Not sent for approval yet'], ['rejected', 'Needs changes']])('in the dropdown a %s venue says "%s"', async (status, label) => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, status, images: [], areas: [] } };
    routes_override['/owner/venues'] = { venues: [{ ...VENUE, status, area_count: 0 }] };
    renderAt('/owner/areas');
    const picker = await screen.findByLabelText('Create playing areas for venue');
    expect(within(picker).getByRole('option', { name: new RegExp(label) })).toBeInTheDocument();
  });
  it('an approved venue has no status text in the dropdown', async () => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, status: 'approved', images: [], areas: [] } };
    routes_override['/owner/venues'] = { venues: [{ ...VENUE, status: 'approved', area_count: 0 }] };
    renderAt('/owner/areas');
    const picker = await screen.findByLabelText('Create playing areas for venue');
    expect(within(picker).getByRole('option')).not.toHaveTextContent(/approval/);
  });
  it('the venues list uses the same status names', async () => {
    routes_override['/owner/venues'] = { venues: [{ ...VENUE, id: 'v1', status: 'draft', area_count: 1 }, { ...VENUE, id: 'v2', name: 'Other', status: 'pending', area_count: 1 }] };
    renderAt('/owner/venues');
    expect(await screen.findByText('Not published')).toBeInTheDocument(); expect(screen.getByText('Under approval')).toBeInTheDocument();
    expect(screen.getByText('Other').closest('article')).toHaveAttribute('data-greyed', 'true'); // greyed out until an admin approves it
    expect(screen.getByText('Green Arena').closest('article')).toHaveAttribute('data-greyed', 'true');
  });
  const card = (name: string) => screen.getByRole('article', { name });
  const venues = (status: string) => { routes_override['/owner/venues'] = { venues: [{ ...VENUE, id: 'v1', status, area_count: 1 }] }; };

  it.each([
    ['draft', ['Edit', 'Send for approval']], ['rejected', ['Edit', 'Send for approval']], ['pending', ['Edit', 'View']], ['ready', ['Edit', 'Publish']], ['approved', ['Edit', 'Deactivate']], ['suspended', []],
  ])('a %s venue card offers %j', async (status, wanted) => {
    venues(status); renderAt('/owner/venues');
    await screen.findByRole('article', { name: 'Green Arena' });
    const c = within(card('Green Arena'));
    for (const name of ['Edit', 'View', 'Send for approval', 'Publish', 'Deactivate']) {
      const el = c.queryByRole('button', { name }) ?? c.queryByRole('link', { name });
      if (wanted.includes(name)) expect(el, name).toBeInTheDocument(); else expect(el, name).toBeNull();
    }
  });
  it('while a venue is under approval its Edit is blocked (greyed, not clickable) and only View is left', async () => {
    venues('pending'); renderAt('/owner/venues');
    await screen.findByRole('article', { name: 'Green Arena' });
    const c = within(card('Green Arena'));
    expect(c.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(c.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(c.getByRole('link', { name: 'View' })).toBeInTheDocument();
    expect(c.getByText(/cannot be edited until KickOff reviews it/)).toBeInTheDocument();
  });
  it('Edit opens the venue form for that venue', async () => {
    venues('ready'); renderAt('/owner/venues');
    await screen.findByRole('article', { name: 'Green Arena' });
    expect(within(card('Green Arena')).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/owner/venues/v1');
  });
  it('Publish makes the venue live for customers straight away', async () => {
    venues('ready'); renderAt('/owner/venues');
    await screen.findByRole('article', { name: 'Green Arena' });
    await userEvent.click(within(card('Green Arena')).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/venues/v1/publish'));
    expect(await screen.findByText(/Customers can find and book this venue now/)).toBeInTheDocument();
  });
  it('Deactivate asks first, then hides the venue from customers', async () => {
    venues('approved'); renderAt('/owner/venues');
    await screen.findByRole('article', { name: 'Green Arena' });
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(within(card('Green Arena')).getByRole('button', { name: 'Deactivate' }));
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/Customers will no longer see or book it/)); expect(api.post).not.toHaveBeenCalled(); // "Cancel" changes nothing
    await userEvent.click(within(card('Green Arena')).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/venues/v1/unpublish'));
    ask.mockRestore();
  });
  it('a refusal (for example no prices yet) is shown, not swallowed', async () => {
    venues('ready'); renderAt('/owner/venues');
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { error: { code: 'venue_not_ready', message: 'Set the prices and opening hours of a playing area before publishing' } } } });
    await screen.findByRole('article', { name: 'Green Arena' });
    await userEvent.click(within(card('Green Arena')).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Set the prices and opening hours/)).toBeInTheDocument();
  });
  it('a venue is not greyed out once KickOff approves it, even before the owner publishes it', async () => {
    routes_override['/owner/venues'] = { venues: [{ ...VENUE, id: 'v1', status: 'ready', area_count: 1 }] };
    renderAt('/owner/venues');
    expect(await screen.findByText('Approved · not published')).toBeInTheDocument();
    expect(screen.getByText('Green Arena').closest('article')).not.toHaveAttribute('data-greyed');
  });
});

describe('sidebar pages manage what the venue page no longer shows', () => {
  it('Playing areas lets you add and manage areas directly', async () => {
    renderAt('/owner/areas');
    expect(await screen.findByRole('heading', { level: 1, name: 'Playing areas' })).toBeInTheDocument();
    expect(await screen.findByText('Turf A')).toBeInTheDocument();
    for (const b of [/Hours & pricing/, /Block slots/]) expect(screen.getByRole('button', { name: b })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pricing \(/ })).toBeNull(); expect(screen.queryByRole('button', { name: /^Operating hours \(/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Add area' }));
    expect(await screen.findByRole('dialog', { name: 'Add playing area' })).toBeInTheDocument();
  });
  it('a ?venue= link opens the page on that venue', async () => {
    routes_override['/owner/venues'] = { venues: [{ ...VENUE, id: 'v1', name: 'Green Arena' }, { ...VENUE, id: 'v2', name: 'Second Arena' }] };
    routes_override['/owner/venues/v2'] = { venue: { ...VENUE, id: 'v2', name: 'Second Arena', images: [] } };
    renderAt('/owner/hours?venue=v2');
    expect(await screen.findByLabelText('Venue')).toHaveValue('v2');
  });
  it('Venue documents live inside Business information (no separate menu item), and old links go there', async () => {
    renderAt('/owner/documents'); // the old link redirects
    expect(await screen.findByRole('heading', { level: 1, name: /Business information/ })).toBeInTheDocument();
    const docs = await screen.findByRole('region', { name: 'Venue documents' });
    expect(await within(docs).findByText('Blurry scan')).toBeInTheDocument(); // the admin's comment on a rejected document is right there
    expect(within(docs).getByRole('heading', { name: 'Upload or replace a document' })).toBeInTheDocument();
    const side = screen.getByRole('navigation', { name: /Owner/ });
    expect(within(side).queryByRole('link', { name: /Venue documents/ })).toBeNull();
    expect(within(side).queryByRole('link', { name: /Gallery & media/ })).toBeNull();
  });
  it('the old /owner/media link lands on My venues', async () => {
    renderAt('/owner/media');
    expect(await screen.findByRole('heading', { level: 1, name: /Your venues/ })).toBeInTheDocument();
  });
});

describe('venue category dropdown', () => {
  it('offers a list of categories instead of free text (asked when editing a venue, not on Add venue), and starts unselected', async () => {
    renderAt('/owner/venues/new'); await screen.findByLabelText('Venue name'); expect(screen.queryByLabelText('Venue category')).not.toBeInTheDocument();
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, category: null, state: 'Karnataka', city: 'Bengaluru' } };
    cleanup(); renderAt('/owner/venues/v1?tab=edit');
    const cat = await screen.findByLabelText('Venue category');
    expect(cat.tagName).toBe('SELECT'); expect(cat).toHaveValue('');
    const opts = within(cat).getAllByRole('option').map((x) => x.textContent);
    expect(opts).toEqual(expect.arrayContaining(['Select category', 'Football turf', 'Box cricket', 'Badminton court', 'Multi-sport turf', 'Sports academy', 'Other']));
    await userEvent.selectOptions(cat, 'Box cricket'); expect(cat).toHaveValue('Box cricket');
  });
  it('keeps a category saved earlier as free text, so editing never loses it', async () => {
    routes_override['/owner/venues/v1'] = { venue: { ...VENUE, category: 'Futsal arena', state: 'Karnataka', city: 'Bengaluru' } };
    renderAt('/owner/venues/v1?tab=edit');
    const cat = await screen.findByLabelText('Venue category');
    expect(cat).toHaveValue('Futsal arena'); expect(within(cat).getAllByRole('option').map((x) => x.textContent)).toContain('Futsal arena');
  });
});

describe('owner pages show real data and handle states', () => {
  it('overview shows the JusGo eight figures and three buttons, and an empty-state when there is no revenue', async () => {
    renderAt('/owner');
    for (const l of ['Total Venues', 'Total Playing Areas', "Today's Bookings", 'Upcoming Bookings', 'Completed Bookings', 'Cancelled Bookings', 'Total Revenue (GTV)', 'Open Slots Today']) expect(await screen.findByText(l), l).toBeInTheDocument();
    for (const l of ['Add Booking', 'Record Payment']) expect(screen.getByRole('link', { name: l })).toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Add event/Academic booking' })).toBeNull();
    expect(screen.getByText('Under approval')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    expect(await screen.findByText(/No revenue recorded for this period yet/)).toBeInTheDocument();
  });

  it('bookings list shows total, what the venue gets, platform fee and pending; Mark as paid clears the pending amount', async () => {
    routes_override['/owner/bookings'] = { bookings: [{ ...BOOKING, id: 'w1', reference: 'KO-WALK1', booking_source: 'offline', total: 1500, owner_amount: '1500', commission_amount: '0', amount_paid: 500, payment_discount: 0 }], total: 1 };
    renderAt('/owner/bookings');
    expect(await screen.findByText('KO-WALK1')).toBeInTheDocument();
    for (const h of ['Total amount', 'You get', 'Platform fee', 'Pending', 'Status', 'Actions']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Price' })).toBeNull();
    expect(screen.getByText('Received ₹500')).toBeInTheDocument();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Mark KO-WALK1 as paid' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/bookings/w1/payments', { amount: 1000, mode: 'offline', note: 'Paid at the venue after playing' }));
  });
  it('a cancelled KickOff booking earns nothing and says why there is no action; a paid one says it was paid through KickOff', async () => {
    routes_override['/owner/bookings'] = { bookings: [{ ...BOOKING, id: 'c1', reference: 'KO-CANC1', status: 'cancelled', booking_source: 'online', total: 983, owner_amount: '884.70', commission_amount: '98.30' }, { ...BOOKING, id: 'p1', reference: 'KO-PAID1', status: 'confirmed', booking_source: 'online', total: 1000, owner_amount: '900', commission_amount: '100' }], total: 2 };
    renderAt('/owner/bookings');
    const row = (await screen.findByText('KO-CANC1')).closest('tr')!;
    expect(row).not.toHaveTextContent('884.70'); expect(row).not.toHaveTextContent('Received'); expect(row).toHaveTextContent('Cancelled, nothing to collect');
    expect(screen.getByText('KO-PAID1').closest('tr')!).toHaveTextContent('Paid through KickOff'); expect(screen.getByText('KO-PAID1').closest('tr')!).toHaveTextContent('Fully paidReceived ₹1,000');
  });
  it('with hours set today but no price, every page except pricing and hours sends the owner to Pricing with a note', async () => {
    routes_override['/owner/pricing-gate'] = { blocked: true, areas: [{ id: 'a1', name: 'Turf A', venueId: 'v1', venueName: 'Green Arena', today: 5, tomorrow: 0 }] };
    renderAt('/owner/customers');
    const note = await screen.findByRole('alert', { name: '' }, { timeout: 4000 }).catch(() => screen.findByText('Set the slot prices first'));
    expect(await screen.findByText('Set the slot prices first')).toBeInTheDocument();
    expect(screen.getByText('Set the slot prices first').parentElement).toHaveTextContent('Turf A (Green Arena) has 5 slots today with no price');
    expect(screen.queryByRole('heading', { level: 1, name: 'Customers' })).toBeNull();
    void note;
  });
  it('Open Slots Today shows open out of all of todays slots', async () => {
    renderAt('/owner');
    expect(await screen.findByLabelText('17 open of 30 slots today')).toHaveTextContent('17 / 30');
  });
  it('bookings page sends the view and filters to the API, supports pagination and shows details', async () => {
    renderAt('/owner/bookings/history');
    expect(await screen.findByText('KO-ABC1234')).toBeInTheDocument();
    expect(calls.find(([u]) => u === '/owner/bookings')![1]).toMatchObject({ view: 'history', limit: 20 });
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument(); // 41 records / 20 per page
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    await waitFor(() => expect(calls.filter(([u]) => u === '/owner/bookings').at(-1)![1]).toMatchObject({ page: 2 }));
    await userEvent.type(screen.getByLabelText('Search'), 'Ravi');
    await waitFor(() => expect(calls.filter(([u]) => u === '/owner/bookings').at(-1)![1]).toMatchObject({ q: 'Ravi', view: 'history' }));
    await userEvent.click(await screen.findByText('KO-ABC1234'));
    const dlg = await screen.findByRole('dialog', { name: /Booking KO-ABC1234/ });
    expect(within(dlg).getByText('₹990')).toBeInTheDocument(); // owner earnings
    expect(within(dlg).getByRole('button', { name: 'Download receipt' })).toBeInTheDocument();
  });

  it('shows an error state with retry when a page fails to load', async () => {
    mockApi(); vi.mocked(api.get).mockImplementation(async (url: string) => { if (url === '/owner/refunds') throw { response: { data: { error: { message: 'Database unavailable' } } } }; return url === '/auth/me' ? { user: OWNER } : url === '/owner/application' ? ACTIVE_APP : url === '/me/notifications' ? { notifications: [], unread: 0 } : {}; });
    renderAt('/owner/refunds');
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('the Settlements page is gone: not in the menu, and the old link lands on Payments', async () => {
    renderAt('/owner/settlements');
    expect(await screen.findByRole('heading', { level: 1, name: /^Report & Payments$/ })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'Payments', selected: true })).toBeInTheDocument();
    const side = screen.getByRole('navigation', { name: /Owner/ });
    expect(within(side).queryByRole('link', { name: /Settlements/ })).toBeNull();
  });

  it('Payments lists the settlements the admin sent, with amount and bank reference, and filters them by status', async () => {
    routes_override['/owner/settlements'] = { summary: { totalEarnings: 5000, completed: 1000, pending: 500, available: 0, holding: 0, disputed: 0, holdHours: 48 }, bank: {}, payouts: [
      { id: 'p1', amount: 1000, period_start: '2030-01-01', period_end: '2030-01-31', status: 'paid', reference: 'UTR12345', paid_at: '2030-02-02T10:00:00Z', created_at: '2030-02-01T10:00:00Z' },
      { id: 'p2', amount: 500, period_start: '2030-02-01', period_end: '2030-02-28', status: 'pending', reference: null, paid_at: null, created_at: '2030-03-01T10:00:00Z' }] };
    renderAt('/owner/payments');
    const sec = await screen.findByRole('region', { name: 'Settlements' });
    expect(within(sec).getByText('UTR12345')).toBeInTheDocument(); expect(within(sec).getByText('₹1,000')).toBeInTheDocument(); expect(within(sec).getByText('₹500')).toBeInTheDocument();
    await userEvent.selectOptions(within(sec).getByLabelText('Settlement'), 'paid');
    expect(within(sec).queryByText('₹500')).toBeNull(); expect(within(sec).getByText('UTR12345')).toBeInTheDocument();
  });

  it('documents list shows admin comments and re-upload requirement for rejected files', async () => {
    renderAt('/owner/account/business');
    expect(await screen.findByText('Blurry scan')).toBeInTheDocument();
    expect(screen.getByText('Rejected · re-upload required')).toBeInTheDocument();
  });

  it('slot management validates the time range before calling the API', async () => {
    renderAt('/owner/slots?area=a1&date=2031-01-01&hour=10');
    await screen.findByRole('heading', { level: 1, name: 'Slot management' });
    await userEvent.selectOptions(screen.getByLabelText('To hour'), '9');
    await userEvent.selectOptions(screen.getByLabelText('To AM or PM'), 'AM');
    await userEvent.click(screen.getByRole('button', { name: /Apply to/ }));
    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByText('End time must be after start time')).toBeInTheDocument();
  });

  it('analytics refuses an inverted date range instead of calling the API', async () => {
    renderAt('/owner/reports');
    await screen.findByText('Gross booking value');
    await userEvent.clear(screen.getByLabelText('To date'));
    await userEvent.type(screen.getByLabelText('To date'), '2000-01-01');
    expect(await screen.findByText(/start date must be before the end date/)).toBeInTheDocument();
  });
  it('Report & Payments is one page with a Report tab (filters) and a Payments tab (all, pending, refunds)', async () => {
    renderAt('/owner/reports');
    expect(await screen.findByRole('heading', { level: 1, name: 'Report & Payments' })).toBeInTheDocument();
    expect(screen.getByText('How your venues and playing areas are performing.')).toBeInTheDocument();
    for (const l of ['From date', 'To date', 'Venue', 'Playing area', 'Sport', 'Booking status', 'Source']) expect(await screen.findByLabelText(l), l).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(await screen.findByText(/What each booking costs, what has been paid/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refunds' }));
    expect(await screen.findByLabelText('Search')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pending' }));
    expect((await screen.findAllByText(/Total pending|Nothing pending/)).length).toBeGreaterThan(0);
  });
});