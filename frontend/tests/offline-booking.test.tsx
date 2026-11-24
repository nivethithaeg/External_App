import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const OWNER = { id: 'o1', email: 'o@x.co', phone: null, fullName: 'Arjun Mehta', role: 'owner', adminRole: null, emailVerified: true, phoneVerified: false };
const ACTIVE = { accountStatus: 'active', application: { status: 'approved', editable: false }, contact: { emailVerified: true }, business: {}, identity: {}, documents: [], requiredDocs: [], venues: [], sections: {}, missing: [], correction: null, events: [] };
const OVERVIEW = { counts: { venues: 1, active_venues: 1, areas: 2 }, today: { bookings: 0, revenue: 0 }, month: { bookings: 0, revenue: 0 }, upcoming: 0, awaitingPayment: 0, slots: { total: 0, booked: 0, available: 0, occupancyPct: 0 }, statusBreakdown: [], schedule: [], nextBookings: [], popularAreas: [], recentTransactions: [], venues: [{ id: 'v1', name: 'Green Arena', city: 'Bengaluru', status: 'approved' }], revenue: { day: [], week: [], month: [], year: [] } };
const slot = (h: number, over: any = {}) => ({ startsAt: `2030-01-02T${String(h).padStart(2, '0')}:30:00.000Z`, endsAt: `2030-01-02T${String(h + 1).padStart(2, '0')}:30:00.000Z`, price: 800, available: true, ...over });
const SLOTS = [slot(1, { available: false, reason: 'past', price: null }), slot(2, { available: false, reason: 'unpriced', price: null }), slot(3, { available: false, reason: 'booked' }), slot(4), slot(5, { price: 1200 })];
const venue = (over: any = {}) => ({ id: 'v1', name: 'Green Arena', city: 'Bengaluru', status: 'approved', timezone: 'Asia/Kolkata',
  areas: [{ id: 'a1', name: 'Turf A', is_active: true, sport_ids: [1, 2], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 180 }, { id: 'a2', name: 'Court B', is_active: true, sport_ids: [2], slot_minutes: 30, min_duration_minutes: 30, max_duration_minutes: 90 }, { id: 'a3', name: 'Closed Turf', is_active: false, sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 60 }, { id: 'a4', name: 'Open Ground', environment: 'outdoor', is_active: true, sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 180 }], ...over });
const calls: { method: string; url: string; body?: any; params?: any }[] = [];
let slotsReply: any;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.setItem('kickoff_token', 't'); calls.length = 0; slotsReply = { slots: SLOTS, timezone: 'Asia/Kolkata' };
  vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => {
    calls.push({ method: 'GET', url, params });
    if (/^\/areas\/.+\/slots$/.test(url)) { if (slotsReply instanceof Error) throw slotsReply; return slotsReply; }
    return ({ '/auth/me': { user: OWNER }, '/owner/application': ACTIVE, '/me/notifications': { notifications: [], unread: 0 }, '/owner/overview': OVERVIEW, '/owner/dashboard': { verification: 'verified' },
      '/owner/venues': { venues: [{ id: 'v1', name: 'Green Arena', city: 'Bengaluru', status: 'approved' }, { id: 'v9', name: 'Draft Arena', city: 'Pune', status: 'draft' }] }, '/owner/venues/v1': { venue: venue() },
      '/sports': { sports: [{ id: 1, name: 'Football' }, { id: 2, name: 'Cricket' }] } } as Record<string, any>)[url] ?? {};
  });
  vi.mocked(api.post).mockImplementation((async (url: string, body: any) => { calls.push({ method: 'POST', url, body }); return { bookingId: 'b1', reference: 'KO-ABC123', venueName: 'Green Arena', areaName: 'Turf A', timezone: 'Asia/Kolkata', startsAt: slot(4).startsAt, endsAt: slot(4).endsAt, subtotal: 800, total: body.amount ?? 800, discount: Math.max(0, 800 - (body.amount ?? 800)) }; }) as any);
});
const open = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
const posts = () => calls.filter((c) => c.method === 'POST');

const fillCustomer = async (mobile = '9876543210', status = 'unpaid') => { await userEvent.type(screen.getByLabelText(/Customer name/), 'Ravi Kumar'); await userEvent.type(screen.getByLabelText(/Customer mobile/), mobile); await userEvent.type(screen.getByLabelText(/^City/), 'Erode'); await userEvent.selectOptions(screen.getByLabelText(/Payment status/), status); };
describe('Overview: Add offline booking', () => {
  it('a mobile that is already saved offers its name: Use fills the name and the empty city', async () => {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => (url === '/owner/customers' ? { customers: [{ name: 'Meera Iyer', mobile: '9812345678', city: 'Chennai' }] } : base(url, params)));
    open('/owner/bookings/new');
    await userEvent.type(await screen.findByLabelText(/Customer mobile/, undefined, { timeout: 4000 }), '98123 45678');
    const note = await screen.findByText(/already saved as/);
    expect(note.parentElement).toHaveTextContent('Meera Iyer (Chennai)');
    await userEvent.click(screen.getByRole('button', { name: 'Use Meera Iyer' }));
    expect(screen.getByLabelText(/Customer name/)).toHaveValue('Meera Iyer'); expect(screen.getAllByLabelText(/^City/)[0]).toHaveValue('Chennai');
    expect(screen.queryByText(/already saved as/)).toBeNull();
  });
  it('has an "Add offline booking" button that opens the booking page', async () => {
    open('/owner');
    const btn = await screen.findByRole('link', { name: /^Add Booking$/, hidden: false });
    expect(btn).toHaveAttribute('href', '/owner/bookings/new');
    await userEvent.click(btn);
    expect(await screen.findByRole('heading', { level: 1, name: 'Add offline booking' }, { timeout: 4000 })).toBeInTheDocument();
  });
  it('is also in the Booking management menu', async () => {
    open('/owner');
    await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening),/ });
    const side = screen.getAllByRole('navigation', { name: /Turf Owner Portal navigation/i })[0];
    await userEvent.click(within(side).getByRole('button', { name: 'Booking management' })); // the menu section opens
    expect(screen.getAllByRole('link', { name: /Add offline booking|^Add Booking$/ }).filter((a) => a.getAttribute('href') === '/owner/bookings/new').length).toBeGreaterThanOrEqual(2); // the dashboard button and the menu item
  });
});

describe('Add offline booking page', () => {
  it('asks for the venue, area, sport, duration and date, and lists only approved venues and active areas', async () => {
    open('/owner/bookings/new');
    const v = await screen.findByLabelText('Venue');
    expect(within(v).getAllByRole('option').map((o) => o.textContent)).toEqual(['Green Arena, Bengaluru']); // the draft venue is not offered
    expect(within(screen.getByLabelText('Playing area')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Turf A', 'Court B', 'Open Ground']); // the inactive area is not offered
    expect(within(screen.getByLabelText('Sport')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Football', 'Cricket']);
    expect(within(screen.getByLabelText('Duration')).getAllByRole('option').map((o) => o.textContent)).toEqual(['1 hr', '2 hr', '3 hr']);
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
  });

  it('shows the area\'s slots for the day with their prices: bookable ones to pick, taken ones struck out, and none that have passed or have no price', async () => {
    open('/owner/bookings/new');
    const list = await screen.findByRole('listbox', { name: 'Time slots' });
    const opts = within(list).getAllByRole('option');
    expect(opts).toHaveLength(3); // the passed and the unpriced slot are not shown
    expect(opts[0]).toHaveTextContent('Booked'); expect(opts[0]).toBeDisabled();
    expect(opts[1]).toHaveTextContent('₹800'); expect(opts[1]).toBeEnabled(); expect(opts[2]).toHaveTextContent('₹1,200');
    await waitFor(() => expect(calls.some((c) => /\/areas\/a1\/slots/.test(c.url) && c.params?.sportId === 1 && c.params?.duration === 60)).toBe(true));
  });

  it('changing the area changes the durations and asks for that area\'s slots', async () => {
    open('/owner/bookings/new');
    await userEvent.selectOptions(await screen.findByLabelText('Playing area'), 'a2');
    expect(within(screen.getByLabelText('Duration')).getAllByRole('option').map((o) => o.textContent)).toEqual(['30 min', '1 hr']); // 30-minute slots: only the standard lengths (30 min, 1, 2, 3, 4, 5 hr) within the area's limits
    expect(within(screen.getByLabelText('Sport')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Cricket']);
    await waitFor(() => expect(calls.some((c) => /\/areas\/a2\/slots/.test(c.url) && c.params?.sportId === 2 && c.params?.duration === 30)).toBe(true));
  });

  it('asks the JusGo booking fields, and sends the whole booking in one request at the slot price', async () => {
    open('/owner/bookings/new');
    await userEvent.click(await screen.findByRole('option', { name: /₹800/ }));
    expect(screen.queryByLabelText(/Amount/)).toBeNull(); expect(screen.queryByLabelText(/Email/)).toBeNull(); expect(screen.queryByLabelText('Notes (optional)')).toBeNull(); // the price is the slot price
    await userEvent.type(screen.getByLabelText(/Customer name/), 'Ravi Kumar'); await userEvent.type(screen.getByLabelText(/Customer mobile/), '98765 43210'); await userEvent.type(screen.getByLabelText(/^City/), 'Erode');
    await userEvent.selectOptions(screen.getByLabelText(/Payment status/), 'partial');
    await userEvent.type(screen.getByLabelText(/Initial payment/), '300'); expect(screen.getByText('₹500')).toBeInTheDocument(); // the pending amount
    await userEvent.selectOptions(screen.getByLabelText(/Mode of payment/), 'online');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ url: '/owner/bookings/offline', body: { areaId: 'a1', sportId: 1, startsAt: slot(4).startsAt, durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210', customerCity: 'Erode', paymentMethod: 'online', amountPaid: 300 } });
    expect(posts()[0].body.amount).toBeUndefined();
  });

  it('Paid sends the online or offline mode; Unpaid sends no mode', async () => {
    open('/owner/bookings/new');
    await userEvent.click(await screen.findByRole('option', { name: /₹800/ }));
    await fillCustomer('9876543210', 'unpaid');
    expect(screen.queryByLabelText(/Mode of payment/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(posts()[0]?.body).toMatchObject({ paymentMethod: 'unpaid' }));
  });

  it('shows the confirmation with the reference and a way to add another', async () => {
    open('/owner/bookings/new');
    await userEvent.click(await screen.findByRole('option', { name: /₹800/ }));
    await fillCustomer();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    const ok = await screen.findByLabelText('Booking confirmed');
    expect(ok).toHaveTextContent('KO-ABC123'); expect(ok).toHaveTextContent('Ravi Kumar'); expect(ok).toHaveTextContent('Unpaid'); expect(ok).toHaveTextContent(/Nothing was charged through KickOff/);
    await userEvent.click(within(ok).getByRole('button', { name: 'Add another offline booking' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add offline booking' })).toBeInTheDocument(); expect(screen.getByLabelText(/Customer name/)).toHaveValue('');
  });

  it('checks the details before sending anything', async () => {
    open('/owner/bookings/new');
    await screen.findByRole('listbox', { name: 'Time slots' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    for (const m of ['Choose a time slot', "Enter the customer's name", 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210', "Enter the customer's city", 'Please select the payment status.']) expect(await screen.findByText(m)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /₹800/ }));
    await userEvent.type(screen.getByLabelText(/Customer name/), 'Ravi'); await userEvent.type(screen.getByLabelText(/Customer mobile/), '12345'); await userEvent.type(screen.getByLabelText(/^City/), 'Erode');
    await userEvent.selectOptions(screen.getByLabelText(/Payment status/), 'paid');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByText('Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210')).toBeInTheDocument(); expect(screen.getByText('Please select the mode of payment.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('on an open ground (outdoor) it also asks Opponent 1 and Opponent 2, and "Copy customer details" fills Opponent 1', async () => {
    open('/owner/bookings/new?area=a4');
    await screen.findByRole('listbox', { name: 'Time slots' });
    expect(await screen.findByText('Opponent 1')).toBeInTheDocument(); expect(screen.getByText('Opponent 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /₹800/ }));
    await fillCustomer();
    await userEvent.click(screen.getByRole('button', { name: 'Copy customer details' }));
    expect(screen.getByLabelText('Opponent 1 name')).toHaveValue('Ravi Kumar'); expect(screen.getByLabelText('Opponent 1 city')).toHaveValue('Erode');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByText("Enter Opponent 2's name")).toBeInTheDocument(); expect(posts()).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Opponent 2 mobile'), '9123456780'); await userEvent.type(screen.getByLabelText('Opponent 2 name'), 'Arun'); await userEvent.type(screen.getByLabelText('Opponent 2 city'), 'Salem');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(posts()[0]?.body).toMatchObject({ opponent1Name: 'Ravi Kumar', opponent1Phone: '9876543210', opponent1City: 'Erode', opponentName: 'Arun', opponentPhone: '9123456780', opponentCity: 'Salem' }));
  });

  it('shows the server\'s reason when the slot was just taken, and keeps the form', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { error: { code: 'slot_unavailable', message: 'That slot is already booked or blocked' } } } });
    open('/owner/bookings/new');
    await userEvent.click(await screen.findByRole('option', { name: /₹800/ }));
    await fillCustomer();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByText('That slot is already booked or blocked')).toBeInTheDocument();
    expect(screen.getByLabelText(/Customer name/)).toHaveValue('Ravi Kumar'); expect(screen.queryByLabelText('Booking confirmed')).toBeNull();
  });

  it('says so when there are no slots that day', async () => {
    slotsReply = { slots: [], timezone: 'Asia/Kolkata' };
    open('/owner/bookings/new');
    expect(await screen.findByText(/No slots on this day/)).toBeInTheDocument();
  });

  it('with no approved venue, explains why and offers no form', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ '/auth/me': { user: OWNER }, '/owner/application': ACTIVE, '/me/notifications': { notifications: [], unread: 0 }, '/owner/venues': { venues: [{ id: 'v9', name: 'Draft Arena', city: 'Pune', status: 'draft' }] } } as Record<string, any>)[url] ?? {});
    open('/owner/bookings/new');
    expect(await screen.findByText('No approved venue yet')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
  });

  it('opens on the venue and area named in the link', async () => {
    open('/owner/bookings/new?venue=v1&area=a2');
    expect(await screen.findByLabelText('Playing area')).toHaveValue('a2');
  });
});
