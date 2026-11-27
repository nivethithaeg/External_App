import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
import { ThemeProvider } from '../src/lib/theme';
import App from '../src/App';
import { BookingWidget } from '../src/components/BookingWidget';
import { BookingDetailPage } from '../src/pages/customer/Account';
import { PaymentCelebrationHost, dismissPaymentCelebration } from '../src/lib/paymentCelebration';
import { openCheckout } from '../src/lib/razorpay';

const USER = { id: 'c1', email: 'p@x.co', phone: '+919800000001', fullName: 'Priya Nair', role: 'customer', adminRole: null, emailVerified: true, phoneVerified: true };
const VENUE = { id: 'v1', name: 'Green Arena', city: 'Bengaluru', address: '12 Park Road', rating_avg: 4.5, rating_count: 8, min_price: 800, cover_image: null, sports: ['Football'], facilities: ['Parking', 'Floodlights'], lat: 12.97, lng: 77.59, is_favourite: false };
const BOOKING = { id: 'b1', reference: 'KO-1', status: 'confirmed', venue_id: 'v1', venue_name: 'Green Arena', area_name: 'Turf A', sport: 'Football', starts_at: '2030-01-05T10:00:00Z', ends_at: '2030-01-05T11:00:00Z', timezone: 'Asia/Kolkata', total: 800, subtotal: 800, discount: 0, payment_status: 'captured', lat: 12.97, lng: 77.59, address: '12 Park Road', city: 'Bengaluru', cancellation_hours: 12, razorpay_payment_id: 'pay_1' };
let routes: Record<string, any> = {};
let calls: { method: string; url: string; body?: any; params?: any }[] = [];

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('playnx_token', 't'); calls = [];
  routes = {
    '/auth/me': { user: USER }, '/me/notifications': { notifications: [], unread: 0 }, '/sports': { sports: [{ id: 1, name: 'Football', slug: 'football' }, { id: 2, name: 'Cricket', slug: 'cricket' }] },
    '/facilities': { facilities: [{ id: 1, name: 'Parking' }, { id: 2, name: 'Floodlights' }] }, '/cities': { cities: [{ city: 'Bengaluru', venues: 1 }] },
    '/venues': { venues: [VENUE], total: 1, limit: 12 }, '/bookings': { bookings: [BOOKING] }, '/offers': { offers: [] }, '/banners': { banners: [] },
    '/bookings/b1': { booking: BOOKING, refunds: [] }, '/me/profile': { user: USER, profile: { city: 'Bengaluru' } }, '/me/login-history': { history: [{ action: 'user.login', ip: '1.2.3.4', created_at: '2030-01-01T10:00:00Z' }] },
  };
  vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => { calls.push({ method: 'GET', url, params }); return routes[url] ?? {}; });
  const w = (method: string) => async (url: string, body?: any) => { calls.push({ method, url, body }); return routes[`${method} ${url}`] ?? {}; };
  vi.mocked(api.post).mockImplementation(w('POST') as any); vi.mocked(api.put).mockImplementation(w('PUT') as any); vi.mocked(api.del).mockImplementation(w('DELETE') as any);
});
const renderAt = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></ThemeProvider></QueryClientProvider>);

describe('customer navigation', () => {
  const LIVE_OFFER = { id: 'o1', code: 'WELCOME10', description: null, discount_type: 'percent', value: 10, max_discount: null, min_amount: 0, valid_from: '2030-01-01T00:00:00Z', valid_to: '2030-12-31T00:00:00Z', per_user_limit: 1, venue_id: null, venue_name: null, uses_left: null, used_by_me: 0 };
  it('groups the portal into menus that open and link to every customer page', async () => {
    routes['/offers'] = { offers: [LIVE_OFFER] };
    renderAt('/home');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const [menu, items] of [['Bookings', ['My Bookings', 'Favourites']], ['Offers', ['Offers & Coupons']], ['Priya', ['Payments', 'My Reviews', 'Notifications', 'Help & Support', 'My Profile', 'Settings']]] as const) {
      await userEvent.click((menu === 'Priya' ? screen : within(nav)).getByRole('button', { name: new RegExp(menu) }));
      const m = screen.getByRole('menu'); for (const i of items) expect(within(m).getByRole('menuitem', { name: i })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    }
  });
});

describe('the Offers menu only exists while a coupon is live', () => {
  it('is hidden in the menu and on the home page when no owner or admin has added a coupon', async () => {
    routes['/offers'] = { offers: [] };
    renderAt('/home');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await within(nav).findByRole('button', { name: /Bookings/ }); expect(within(nav).queryByRole('button', { name: /Explore/ })).toBeNull(); // no Explore menu
    expect(within(nav).queryByRole('button', { name: /Offers/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Explore offers' })).toBeNull();
  });
  it('appears once a coupon is live, including the home-page shortcut', async () => {
    routes['/offers'] = { offers: [{ id: 'o1', code: 'WELCOME10', discount_type: 'percent', value: 10, valid_to: '2030-12-31T00:00:00Z' }] };
    renderAt('/home');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('button', { name: /Offers/ })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Explore offers' })).toHaveAttribute('href', '/offers');
  });
});

describe('customer home dashboard', () => {
  it('greets the customer and books from home: venue, then its playing areas, then a slot (no Explore page)', async () => {
    routes['/venues'] = { venues: [VENUE], total: 1, limit: 50 };
    routes[`/venues/${VENUE.id}`] = { venue: { ...VENUE, timezone: 'Asia/Kolkata', facilities: [], images: [], areas: [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], pricing: [] }, { id: 'a2', name: 'Court B', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], pricing: [] }] } };
    renderAt('/home');
    expect(await screen.findByText(/Welcome back, Priya/)).toBeInTheDocument(); expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Your Game\.\s*Your Place\.\s*Your Play\./);
    expect(screen.queryByText('Your upcoming games')).toBeNull(); expect(calls.some((c) => c.url === '/bookings')).toBe(false);
    expect(screen.queryByRole('search', { name: 'Search turfs' })).toBeNull();
    const book = screen.getByRole('region', { name: 'Book a turf' });
    await userEvent.click(await within(book).findByRole('button', { name: /Green Arena/ })); // the turfs show as cards
    const areas = await within(book).findByRole('region', { name: 'Playing areas' });
    expect(within(areas).getByText('Turf A')).toBeInTheDocument(); expect(within(areas).getByText('Court B')).toBeInTheDocument();
    expect(within(book).queryByRole('heading', { name: 'Book a slot' })).toBeNull(); // nothing to book until a playing area is chosen
    await userEvent.click(within(within(areas).getByRole('article', { name: 'Playing area Court B' })).getByRole('button', { name: 'Book this area' }));
    expect(await within(book).findByRole('heading', { name: 'Book a slot' })).toBeInTheDocument();
    expect(within(book).getByLabelText('Playing area')).toHaveValue('a2');
  });
  it('the home filters decide the playing areas shown: with a sport chosen, only the areas that offer it', async () => {
    routes['/sports'] = { sports: [{ id: 1, name: 'Football', slug: 'football' }, { id: 2, name: 'Cricket', slug: 'cricket' }] };
    routes['/venues'] = { venues: [VENUE], total: 1, limit: 50 };
    routes[`/venues/${VENUE.id}`] = { venue: { ...VENUE, timezone: 'Asia/Kolkata', facilities: [], images: [], areas: [
      { id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], pricing: [] },
      { id: 'a2', name: 'Nets B', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 2, name: 'Cricket' }], pricing: [] }] } };
    renderAt('/home');
    await screen.findByText(/Welcome back, Priya/); // the signed-in home (not the guest page shown while signing in)
    const book = screen.getByRole('region', { name: 'Book a turf' });
    await waitFor(() => expect(within(book).getByRole('option', { name: 'Cricket' })).toBeInTheDocument());
    await userEvent.selectOptions(within(book).getByLabelText(/^Sport/), 'cricket');
    await userEvent.click(within(book).getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/venues' && c.params?.sport === 'cricket')).toBe(true));
    const areas = await within(book).findByRole('region', { name: 'Playing areas' }); // the only matching venue is chosen at once
    expect(within(areas).getByText('Nets B')).toBeInTheDocument(); expect(within(areas).queryByText('Turf A')).toBeNull();
  });
  it('home filters include date and time: they go to the venue search, and the slot box opens on that date showing only that time', async () => {
    routes['/venues'] = { venues: [VENUE], total: 1, limit: 50 };
    routes[`/venues/${VENUE.id}`] = { venue: { ...VENUE, timezone: 'Asia/Kolkata', facilities: [], images: [], areas: [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], pricing: [] }] } };
    const at = (h: number) => ({ startsAt: `2030-01-05T${String(h - 5).padStart(2, '0')}:30:00.000Z`, endsAt: `2030-01-05T${String(h - 4).padStart(2, '0')}:30:00.000Z`, price: 800, available: true }); // h = IST hour
    routes['/areas/a1/slots'] = { slots: [at(7), at(18), at(19), at(21)], timezone: 'Asia/Kolkata' };
    renderAt('/home');
    await screen.findByText(/Welcome back, Priya/);
    const book = screen.getByRole('region', { name: 'Book a turf' });
    fireEvent.change(within(book).getByLabelText(/^Date/), { target: { value: '2030-01-05' } });
    const pick = async (name: string, h: string, ap: string) => { await userEvent.selectOptions(within(book).getByLabelText(`${name} hour`), h); await userEvent.selectOptions(within(book).getByLabelText(`${name} AM or PM`), ap); };
    await pick('From time', '6', 'PM'); await pick('To time', '9', 'PM'); // 12-hour pickers with AM / PM
    expect(calls.some((c) => c.url === '/venues' && c.params?.date)).toBe(false); // nothing is applied until Filter is pressed
    await userEvent.click(within(book).getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/venues' && c.params?.date === '2030-01-05' && c.params?.from === '18:00' && c.params?.to === '21:00')).toBe(true));
    const areas = await within(book).findByRole('region', { name: 'Playing areas' });
    await userEvent.click(within(within(areas).getByRole('article', { name: 'Playing area Turf A' })).getByRole('button', { name: 'Book this area' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/areas/a1/slots' && c.params?.date === '2030-01-05')).toBe(true));
    expect(await within(book).findByText('Showing slots from 6:00 PM to 9:00 PM.')).toBeInTheDocument();
    const shown = within(within(book).getByRole('listbox', { name: 'Time slots' })).getAllByRole('option').map((o) => o.textContent);
    expect(shown.length).toBe(2); // 6 pm and 7 pm, not 7 am or 9 pm
    await userEvent.click(within(book).getByRole('button', { name: 'Show all times' }));
    expect(within(within(book).getByRole('listbox', { name: 'Time slots' })).getAllByRole('option').length).toBe(4);
  });
  it('one filter on its own is enough: only a sport, then Filter', async () => {
    renderAt('/home');
    await screen.findByText(/Welcome back, Priya/);
    const book = screen.getByRole('region', { name: 'Book a turf' });
    await waitFor(() => expect(within(book).getByRole('option', { name: 'Cricket' })).toBeInTheDocument());
    await userEvent.selectOptions(within(book).getByLabelText(/^Sport/), 'cricket');
    await userEvent.click(within(book).getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/venues' && c.params?.sport === 'cricket' && !c.params?.date)).toBe(true));
  });
  it('a search with no free slot says so', async () => {
    routes['/venues'] = { venues: [], total: 0, limit: 50 };
    renderAt('/home');
    await screen.findByText(/Welcome back, Priya/);
    const book = screen.getByRole('region', { name: 'Book a turf' });
    fireEvent.change(within(book).getByLabelText(/^Date/), { target: { value: '2030-01-05' } });
    await userEvent.click(within(book).getByRole('button', { name: 'Filter' }));
    expect(await within(book).findByText('No slots available for your search.')).toBeInTheDocument();
    expect(within(book).getByRole('status')).toHaveTextContent(/No turf has a free slot on .*2030/);
  });
  it('the old Explore page now opens the booking section on home', async () => {
    renderAt('/venues');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Book a turf' })).toBeInTheDocument());
  });
});

describe('advance bookings in my bookings', () => {
  it('the booking details say only the advance was paid, and what is left to pay at the venue', async () => {
    routes['/bookings/b1'] = { booking: { ...BOOKING, total: 1000, subtotal: 1000, discount: 0, advance_amount: 500, amount_paid: 500, payment_discount: 0, status: 'confirmed', payment_status: 'captured' }, refunds: [] };
    renderAt('/bookings/b1');
    const box = await screen.findByLabelText('Advance payment');
    expect(box).toHaveTextContent('Paid online (advance 50%)₹500'); expect(box).toHaveTextContent('To pay at the venue after the game₹500');
  });
  it('the receipt shows the advance as the amount paid, not the whole total', async () => {
    routes['/bookings/b1'] = { booking: { ...BOOKING, total: 1000, subtotal: 1000, discount: 0, advance_amount: 500, amount_paid: 500, status: 'confirmed', payment_status: 'captured' }, refunds: [] };
    routes['/bookings/b1/invoice'] = { invoice: null };
    renderAt('/bookings/b1/receipt');
    expect(await screen.findByText('Amount paid (advance 50%)')).toBeInTheDocument();
    expect(screen.getByText('Balance, paid at the venue')).toBeInTheDocument();
  });
});

describe('payment success celebration', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 60, sports: [{ id: 1, name: 'Football' }] }];
  const slots = [{ startsAt: '2030-01-01T14:30:00.000Z', endsAt: '2030-01-01T15:30:00.000Z', price: 800, available: true }];
  beforeEach(() => dismissPaymentCelebration());
  const run = async () => {
    routes['/areas/a1/slots'] = { slots, timezone: 'Asia/Kolkata' };
    routes['POST /slots/lock'] = { lockId: 'l1', expiresAt: new Date(Date.now() + 600000).toISOString(), startsAt: slots[0].startsAt, endsAt: slots[0].endsAt, price: 800 };
    routes['POST /bookings'] = { bookingId: 'b1', total: 800, order: { id: 'order_1', amount: 800, keyId: 'rzp_test' } };
    vi.mocked(openCheckout).mockResolvedValueOnce({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' } as any);
    const view = render(<React.StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={['/pay']}><AuthProvider>
      <PaymentCelebrationHost /><Routes><Route path="/pay" element={<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />} /><Route path="/bookings/:id" element={<BookingDetailPage />} /><Route path="/home" element={<p>Customer dashboard</p>} /></Routes></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider></React.StrictMode>);
    await userEvent.click((await screen.findAllByRole('option', { name: /pm|am/i }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: /Review & pay/ })); await userEvent.click(await screen.findByRole('button', { name: /Confirm and pay/ })); // the summary comes first
    return view;
  };
  it('appears once the server has verified the payment, then the button goes to the dashboard', async () => {
    routes['POST /bookings/b1/verify-payment'] = { status: 'confirmed' };
    await run();
    const dlg = await screen.findByRole('dialog', { name: 'Payment Succeeded!' });
    expect(calls.some((c) => c.method === 'POST' && c.url === '/bookings/b1/verify-payment')).toBe(true);
    expect(within(dlg).getByText('Your transaction was completed successfully. Thank you for your purchase!')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Go to Your Dashboard' }));
    expect(await screen.findByText('Customer dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Payment Succeeded!' })).toBeNull();
  });
  it('never appears when the server does not verify the payment', async () => {
    const ok = vi.mocked(api.post).getMockImplementation()!;
    vi.mocked(api.post).mockImplementation(async (url: string, body?: any) => { if (url.endsWith('/verify-payment')) { calls.push({ method: 'POST', url, body }); throw new Error('Payment could not be verified'); } return ok(url, body); });
    await run();
    await waitFor(() => expect(calls.some((c) => c.url === '/bookings/b1/verify-payment')).toBe(true));
    expect(screen.queryByRole('dialog', { name: 'Payment Succeeded!' })).toBeNull();
  });
  it('is not shown just by visiting a booking page', async () => {
    renderAt('/bookings/b1'); await screen.findAllByText('KO-1');
    expect(screen.queryByRole('dialog', { name: 'Payment Succeeded!' })).toBeNull();
  });
});

describe('customer logout', () => {
  it('asks before logging out, and only ends the session when confirmed', async () => {
    renderAt('/home');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    const dlg = await screen.findByRole('dialog', { name: 'Log out?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Stay logged in' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log out?' })).toBeNull());
    expect(sessionStorage.getItem('playnx_token')).toBe('t');
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Log out?' })).getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(sessionStorage.getItem('playnx_token')).toBeNull());
  });
});

describe('venue discount and the booking summary', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 60, sports: [{ id: 1, name: 'Football' }] }];
  const slots = [{ startsAt: '2030-01-01T14:30:00.000Z', endsAt: '2030-01-01T15:30:00.000Z', price: 800, available: true }];
  it('shows the discount on the slot and in a price breakdown before paying, then pays the discounted total', async () => {
    routes['/areas/a1/slots'] = { slots, timezone: 'Asia/Kolkata', discountPercent: 25 };
    routes['POST /slots/lock'] = { lockId: 'l1', expiresAt: new Date(Date.now() + 600000).toISOString(), startsAt: slots[0].startsAt, endsAt: slots[0].endsAt, price: 800 };
    routes['POST /bookings'] = { bookingId: 'b1', total: 600, order: { id: 'order_1', amount: 600, keyId: 'rzp_test' } };
    routes['POST /bookings/b1/verify-payment'] = { status: 'confirmed' };
    vi.mocked(openCheckout).mockResolvedValueOnce({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' } as any);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} discountPercent={25} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    const slot = (await screen.findAllByRole('option', { name: /pm|am/i }))[0];
    expect(slot).toHaveTextContent('₹800'); expect(slot).toHaveTextContent('₹600'); // struck-through price and the discounted one
    await userEvent.click(slot);
    await userEvent.click(await screen.findByRole('button', { name: /Review & pay ₹600/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Confirm your booking' });
    expect(within(dlg).getByText('Green Arena')).toBeInTheDocument();
    const lines = within(dlg).getByLabelText('Price breakdown');
    expect(lines).toHaveTextContent('₹800'); expect(lines).toHaveTextContent('Venue discount (25% off)'); expect(lines).toHaveTextContent('−₹200'); expect(lines).toHaveTextContent('Total to pay₹600');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/slots/lock')).toBe(false); // nothing is held or charged until the customer confirms
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm and pay ₹600' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/bookings/b1/verify-payment')).toBe(true));
    dismissPaymentCelebration();
  });

  it('several neighbouring free slots can be picked and are booked together as one booking', async () => {
    const two = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 180, sports: [{ id: 1, name: 'Football' }] }];
    const s3 = [0, 1, 2].map((i) => ({ startsAt: new Date(Date.parse('2030-01-01T12:30:00.000Z') + i * 3600000).toISOString(), endsAt: new Date(Date.parse('2030-01-01T13:30:00.000Z') + i * 3600000).toISOString(), price: 800, available: true }));
    routes['/areas/a1/slots'] = { slots: s3, timezone: 'Asia/Kolkata', discountPercent: 0 };
    routes['POST /slots/lock'] = { lockId: 'l1', expiresAt: new Date(Date.now() + 600000).toISOString(), startsAt: s3[0].startsAt, endsAt: s3[1].endsAt, price: 1600 };
    routes['POST /bookings'] = { bookingId: 'b1', total: 1600, order: { id: 'order_1', amount: 1600, keyId: 'rzp_test' } };
    routes['POST /bookings/b1/verify-payment'] = { status: 'confirmed' };
    vi.mocked(openCheckout).mockResolvedValueOnce({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' } as any);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={two} discountPercent={0} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    const opts = await screen.findAllByRole('option', { name: /pm|am/i });
    await userEvent.click(opts[0]); await userEvent.click(opts[1]);
    expect(opts[0]).toHaveAttribute('aria-selected', 'true'); expect(opts[1]).toHaveAttribute('aria-selected', 'true'); expect(opts[2]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/2 slots picked/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Review & pay ₹1,600/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Confirm your booking' });
    await userEvent.click(within(dlg).getByRole('button', { name: /Confirm and pay/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/slots/lock')?.body).toMatchObject({ startsAt: s3[0].startsAt, durationMinutes: 120 }));
    dismissPaymentCelebration();
  });

  it('a venue that takes an advance says so before a slot is chosen, and charges only the advance', async () => {
    routes['/areas/a1/slots'] = { slots, timezone: 'Asia/Kolkata', discountPercent: 0 };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} discountPercent={0} advancePercent={50} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    expect(await screen.findByText('Pay 50% now, the rest at the venue.')).toBeInTheDocument();
    await userEvent.click((await screen.findAllByRole('option', { name: /pm|am/i }))[0]);
    expect(await screen.findByRole('button', { name: /Review & pay ₹400/ })).toBeInTheDocument(); // half of ₹800
  });

  it('tells the customer why prices differ on a holiday date', async () => {
    routes['/areas/a1/slots'] = { slots, timezone: 'Asia/Kolkata', discountPercent: 0, specialPricing: { label: 'Diwali weekend', percent: 25 } };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    expect(await screen.findByRole('note')).toHaveTextContent('Diwali weekend: prices on this date are 25% higher than usual.');
  });

  it('Back on the summary closes it without booking', async () => {
    routes['/areas/a1/slots'] = { slots, timezone: 'Asia/Kolkata', discountPercent: 0 };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    await userEvent.click((await screen.findAllByRole('option', { name: /pm|am/i }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: /Review & pay/ }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Confirm your booking' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm your booking' })).toBeNull());
    expect(calls.some((c) => c.method === 'POST' && c.url === '/bookings')).toBe(false);
  });

});

describe('rescheduling a booking', () => {
  const day = '2030-01-08';
  const slot = (h: number, price: number, available = true) => ({ startsAt: `${day}T${String(h).padStart(2, '0')}:00:00.000Z`, endsAt: `${day}T${String(h + 1).padStart(2, '0')}:00:00.000Z`, price, available });
  const booking = (over: any = {}) => ({ ...BOOKING, area_id: 'a1', sport_id: 1, source: 'online', cancellation_hours: 24, reschedule_count: 0, ...over });
  const open = async (over: any = {}) => { routes['/bookings/b1'] = { booking: booking(over), refunds: [] }; renderAt('/bookings/b1'); await userEvent.click(await screen.findByRole('button', { name: 'Reschedule' })); return screen.findByRole('dialog', { name: 'Reschedule your booking' }); };

  it('offers only free slots at the same price, says how many were hidden, and moves the booking when confirmed', async () => {
    routes['/areas/a1/slots'] = { slots: [slot(4, 800), slot(5, 800, false), slot(6, 1200), slot(7, 800)], timezone: 'Asia/Kolkata' };
    const dlg = await open();
    const list = await within(dlg).findByRole('listbox', { name: 'Available times' });
    expect(within(list).getAllByRole('option')).toHaveLength(2); // two free slots at the same price; the taken one and the dearer one are not offered
    expect(within(dlg).getByText(/1 free slot is hidden because it costs a different price/)).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/areas/a1/slots' && c.params?.sportId === 1 && c.params?.duration === 60)).toBe(true);
    expect(within(dlg).getByRole('button', { name: 'Confirm new time' })).toBeDisabled();
    await userEvent.click(within(list).getAllByRole('option')[1]);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm new time' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/bookings/b1/reschedule')?.body).toEqual({ startsAt: `${day}T07:00:00.000Z` }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reschedule your booking' })).toBeNull());
  });

  it('explains when nothing is free at the same price that day', async () => {
    routes['/areas/a1/slots'] = { slots: [slot(6, 1200)], timezone: 'Asia/Kolkata' };
    const dlg = await open();
    expect(await within(dlg).findByText(/No free slots at the same price/)).toBeInTheDocument();
  });

  it('shows no Reschedule button once it has been moved, inside the cancellation window, or for a walk-in', async () => {
    routes['/bookings/b1'] = { booking: booking({ reschedule_count: 1 }), refunds: [] }; const a = renderAt('/bookings/b1');
    expect(await screen.findByText('↻ Rescheduled')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull(); a.unmount();
    routes['/bookings/b1'] = { booking: booking({ starts_at: new Date(Date.now() + 3 * 3600000).toISOString(), ends_at: new Date(Date.now() + 4 * 3600000).toISOString() }), refunds: [] }; const b = renderAt('/bookings/b1');
    await screen.findByRole('button', { name: 'Cancel booking' }); expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull(); b.unmount();
    routes['/bookings/b1'] = { booking: booking({ status: 'pending' }), refunds: [] }; renderAt('/bookings/b1');
    await screen.findByRole('button', { name: 'Cancel booking' }); expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });
});

describe('notification preferences', () => {
  it('shows each alert category as a switch, saves a change at once, and says in-app alerts always stay on', async () => {
    routes['/me/notification-preferences'] = { preferences: { bookings: true, reminders: true, announcements: true } };
    routes['PUT /me/notification-preferences'] = { preferences: { bookings: true, reminders: false, announcements: true } };
    renderAt('/profile');
    const box = await screen.findByRole('region', { name: 'Notification preferences' });
    expect(within(box).getByText(/always appear inside PlaynX/)).toBeInTheDocument();
    const sw = await within(box).findByRole('switch', { name: 'Game reminders' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    routes['/me/notification-preferences'] = { preferences: { bookings: true, reminders: false, announcements: true } }; // what the server will return after the save
    await userEvent.click(sw);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/me/notification-preferences')?.body).toEqual({ reminders: false }));
    await waitFor(() => expect(within(box).getByRole('switch', { name: 'Game reminders' })).toHaveAttribute('aria-checked', 'false'));
    expect(within(box).getByRole('switch', { name: 'Offers and news' })).toHaveAttribute('aria-checked', 'true'); // the others are untouched
  });
});

describe('weekly and wallet options when booking', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 60, sports: [{ id: 1, name: 'Football' }] }];
  let busyDates: string[] = [];
  const mount = async (balance = 0) => {
    routes['/me/wallet'] = { balance, entries: [], expiringSoon: null, expiryMonths: 12 };
    vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => { calls.push({ method: 'GET', url, params }); if (url === '/areas/a1/slots') return { timezone: 'Asia/Kolkata', discountPercent: 0, slots: [{ startsAt: `${params.date}T14:30:00.000Z`, endsAt: `${params.date}T15:30:00.000Z`, price: 800, available: !busyDates.includes(params.date) }] }; return routes[url] ?? {}; });
    routes['POST /slots/lock'] = { lockId: 'l1', expiresAt: new Date(Date.now() + 600000).toISOString(), price: 800 };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    await userEvent.click((await screen.findAllByRole('option', { name: /pm|am/i }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: /Review & pay/ }));
    return screen.findByRole('dialog', { name: 'Confirm your booking' });
  };
  beforeEach(() => { busyDates = []; dismissPaymentCelebration(); });

  it('repeats a slot weekly: lists every date with its price, books them in one request, and pays once', async () => {
    routes['POST /bookings/recurring'] = { bookingId: 'b1', seriesId: 's1', total: 3200, cardDue: 3200, walletUsed: 0, order: { id: 'order_1', amount: 3200, keyId: 'rzp_test' } };
    routes['POST /bookings/b1/verify-payment'] = { status: 'confirmed' };
    vi.mocked(openCheckout).mockResolvedValueOnce({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 's' } as any);
    const dlg = await mount();
    await userEvent.selectOptions(within(dlg).getByLabelText('Repeat weekly'), '4');
    const list = await within(dlg).findByLabelText('Weekly dates'); await waitFor(() => expect(within(list).getAllByText('₹800')).toHaveLength(4));
    expect(within(dlg).getByLabelText('Price breakdown')).toHaveTextContent('₹3,200');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm and pay ₹3,200' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/bookings/recurring')?.body).toMatchObject({ areaId: 'a1', sportId: 1, durationMinutes: 60, weeks: 4 }));
    expect(calls.some((c) => c.url === '/slots/lock')).toBe(false); // a series has no separate hold step
    await waitFor(() => expect(calls.some((c) => c.url === '/bookings/b1/verify-payment')).toBe(true));
  });

  it('will not book a series when one of the dates is taken, and says which', async () => {
    const d = new Date(Date.now() + 14 * 86400000); busyDates = [d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })];
    const dlg = await mount(); await userEvent.selectOptions(within(dlg).getByLabelText('Repeat weekly'), '3');
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('One date is not available'); expect(within(dlg).getByText('Not available')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: /Confirm and pay/ })).toBeDisabled();
    await userEvent.selectOptions(within(dlg).getByLabelText('Repeat weekly'), '2'); // fewer weeks avoids the clash
    await waitFor(() => expect(within(dlg).getByRole('button', { name: /Confirm and pay/ })).toBeEnabled());
  });

  it('uses wallet money first: shows what the wallet and the card pay, and asks the server for it', async () => {
    routes['POST /bookings'] = { bookingId: 'b1', total: 800, walletUsed: 300, cardDue: 500, order: { id: 'order_1', amount: 500, keyId: 'rzp_test' } };
    routes['POST /bookings/b1/verify-payment'] = { status: 'confirmed' };
    vi.mocked(openCheckout).mockResolvedValueOnce({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 's' } as any);
    const dlg = await mount(300);
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Use my wallet balance' }));
    const lines = within(dlg).getByLabelText('Price breakdown'); expect(lines).toHaveTextContent('From your wallet−₹300'); expect(lines).toHaveTextContent('Total to pay₹500');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm and pay ₹500' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/bookings')?.body).toMatchObject({ lockId: 'l1', useWallet: true }));
  });

  it('covers a whole booking from the wallet with no card payment', async () => {
    routes['POST /bookings'] = { bookingId: 'b2', total: 800, walletUsed: 800, cardDue: 0, order: null };
    const dlg = await mount(2000);
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Use my wallet balance' }));
    expect(within(dlg).getByLabelText('Price breakdown')).toHaveTextContent('Total to pay₹0');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/bookings')).toBe(true)); expect(openCheckout).not.toHaveBeenCalled();
  });

  it('offers no wallet option without a balance', async () => {
    const dlg = await mount(0); expect(within(dlg).queryByRole('checkbox', { name: 'Use my wallet balance' })).toBeNull();
  });
});

describe('wallet page', () => {
  it('shows the balance, what is about to expire, and the history', async () => {
    routes['/me/wallet'] = { balance: 450, expiryMonths: 12, expiringSoon: { amount: 150, at: '2030-03-01T00:00:00Z' }, entries: [{ id: 2, delta: -200, kind: 'booking_payment', note: 'Booking KO-9', created_at: '2030-01-02T10:00:00Z', reference: 'KO-9' }, { id: 1, delta: 650, kind: 'refund', note: 'Booking KO-5 cancelled', created_at: '2030-01-01T10:00:00Z', reference: 'KO-5' }] };
    renderAt('/wallet');
    expect(await screen.findByRole('heading', { level: 1, name: 'My wallet' })).toBeInTheDocument(); expect(screen.getByText('₹450')).toBeInTheDocument();
    expect(screen.getByText(/₹150 expires on/)).toBeInTheDocument(); expect(screen.getByText(/cannot be withdrawn as cash/)).toBeInTheDocument();
    expect(screen.getByText('Refund kept as credit')).toBeInTheDocument(); expect(screen.getByText('+₹650')).toBeInTheDocument(); expect(screen.getByText('−₹200')).toBeInTheDocument();
  });
  it('says so when there is no activity', async () => { routes['/me/wallet'] = { balance: 0, expiryMonths: 12, expiringSoon: null, entries: [] }; renderAt('/wallet'); expect(await screen.findByText('No wallet activity yet')).toBeInTheDocument(); });
});

describe('cancelling with a wallet refund or a weekly series', () => {
  const booking = (over: any = {}) => ({ ...BOOKING, area_id: 'a1', source: 'online', cancellation_hours: 24, total: 800, wallet_amount: 0, ...over });
  const openCancel = async (b: any) => { routes['/bookings/b1'] = { booking: b, refunds: [] }; renderAt('/bookings/b1'); await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' })); return screen.findByRole('dialog', { name: 'Cancel this booking?' }); };
  it('offers the refund to the original method or as wallet credit, and sends the choice', async () => {
    routes['POST /bookings/b1/cancel'] = { status: 'cancelled', refundAmount: 800, toWallet: 800 };
    const dlg = await openCancel(booking());
    const group = within(dlg).getByRole('radiogroup', { name: 'Where the refund goes' }); expect(within(group).getByRole('radio', { name: /original payment method/ })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: /wallet credit/ }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/bookings/b1/cancel')?.body).toMatchObject({ refundTo: 'wallet' }));
  });
  it('tells the customer the wallet-paid part returns to the wallet', async () => {
    const dlg = await openCancel(booking({ wallet_amount: 300 })); expect(within(dlg).getByText(/₹300 you paid from your wallet always goes back to your wallet/)).toBeInTheDocument();
  });
  it('cancels this game or all later games of a weekly series', async () => {
    routes['POST /bookings/b1/cancel-series'] = { cancelled: 3, refundAmount: 2400, toWallet: 0 };
    const dlg = await openCancel(booking({ series_id: 's1', series_index: 1, series_count: 4 }));
    expect(screen.getByText('🔁 Weekly game 2 of 4')).toBeInTheDocument();
    await userEvent.click(within(within(dlg).getByRole('radiogroup', { name: 'Which games' })).getByRole('radio', { name: /every later one/ }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/bookings/b1/cancel-series')).toBe(true));
  });
});

describe('cookie notice and policy', () => {
  it('tells visitors what is stored once, remembers they saw it, and links to the policy', async () => {
    localStorage.removeItem('playnx_cookie_notice');
    const view = renderAt('/home');
    const note = await screen.findByRole('region', { name: 'Cookie notice' });
    expect(within(note).getByRole('link', { name: 'Cookie policy' })).toHaveAttribute('href', '/cookies');
    await userEvent.click(within(note).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Cookie notice' })).toBeNull());
    expect(localStorage.getItem('playnx_cookie_notice')).toBe('1');
    view.unmount(); renderAt('/home');
    await screen.findByRole('heading', { level: 1, name: /Your Game/ }); expect(screen.queryByRole('region', { name: 'Cookie notice' })).toBeNull();
  });
  it('the Cookie policy page lists what is stored and links to account deletion in the privacy policy', async () => {
    renderAt('/cookies');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cookie policy' })).toBeInTheDocument();
    expect(screen.getAllByText(/advertising or tracking cookies/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
  });
});

describe('sports categories and nearby', () => {
  it('sport cards open Explore with the sport already selected', async () => {
    renderAt('/sports');
    expect(await screen.findByRole('link', { name: 'Explore Football turfs' })).toHaveAttribute('href', '/venues?sport=football');
  });

  it('never asks for the location until the customer clicks, and lets them pick a city instead', async () => {
    const geo = { getCurrentPosition: vi.fn((ok: any) => ok({ coords: { latitude: 12.9716, longitude: 77.5946 } })) };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    renderAt('/nearby');
    expect(await screen.findByText('Where are you playing?')).toBeInTheDocument(); expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    const state = screen.getByLabelText('Or choose a state'); const city = screen.getByLabelText('City');
    expect(state).toBeInstanceOf(HTMLSelectElement); expect(city).toBeDisabled();
    await userEvent.selectOptions(state, 'Karnataka');
    expect(within(city).getByRole('option', { name: 'Bengaluru' })).toBeInTheDocument(); expect(within(city).queryByRole('option', { name: 'Chennai' })).not.toBeInTheDocument();
    await userEvent.selectOptions(city, 'Bengaluru');
    await waitFor(() => expect(calls.some((c) => c.url === '/venues' && c.params?.state === 'Karnataka' && c.params?.city === 'Bengaluru')).toBe(true));
    expect((await screen.findAllByText('Green Arena')).length).toBeGreaterThan(0); expect(screen.getByRole('link', { name: 'Get directions' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Use my current location/ }));
    await waitFor(() => expect(calls.some((c) => c.url === '/venues' && c.params?.sort === 'distance' && c.params?.lat === 12.9716)).toBe(true));
  });
});

describe('my bookings', () => {
  it('has All, Upcoming, Completed and Cancelled tabs, filters, and per-booking actions', async () => {
    renderAt('/bookings');
    expect((await screen.findAllByText('Green Arena')).length).toBeGreaterThan(0);
    for (const t of ['All', 'Upcoming', 'Completed', 'Cancelled']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    for (const a of ['Details', 'Receipt', 'Cancel', 'Book again', 'Directions']) expect(screen.getByRole('link', { name: a })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/bookings' && c.params?.tab === 'completed')).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText('Payment'), 'failed');
    await waitFor(() => expect(calls.some((c) => c.url === '/bookings' && c.params?.payment === 'failed')).toBe(true));
  });

  it('shows a printable receipt with the transaction id', async () => {
    renderAt('/bookings/b1/receipt');
    const r = await screen.findByLabelText('Receipt');
    expect(r).toHaveTextContent('Payment receipt'); expect(r).toHaveTextContent('pay_1'); expect(r).toHaveTextContent('Amount paid');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });
});

describe('booking reference at the gate', () => {
  it('shows the booking reference (no QR code) on a confirmed booking', async () => {
    routes['/bookings/b1'] = { booking: { ...BOOKING, status: 'confirmed' }, refunds: [] }; renderAt('/bookings/b1');
    expect(await screen.findByLabelText('Booking reference KO-1')).toBeInTheDocument();
    expect(screen.queryByAltText(/QR/)).toBeNull();
  });
});

describe('offers and coupons', () => {
  const OFFER = { id: 'o1', code: 'WELCOME10', description: 'Ten percent off', discount_type: 'percent', value: 10, max_discount: 200, min_amount: 500, valid_from: '2030-01-01T00:00:00Z', valid_to: '2030-12-31T00:00:00Z', per_user_limit: 1, venue_id: null, venue_name: null, uses_left: 40, used_by_me: 0 };
  it('lists the conditions, copies a code, and carries it to checkout', async () => {
    routes['/offers'] = { offers: [OFFER] };
    renderAt('/offers');
    expect(await screen.findByText('WELCOME10')).toBeInTheDocument();
    const ticket = screen.getByRole('article', { name: 'Coupon WELCOME10' });
    expect(ticket).toHaveTextContent(/10%\s*off/i); expect(ticket).toHaveTextContent('On bookings above ₹500, up to ₹200 off');
    for (const t of [/Valid till/, /All venues and sports/, /One use per customer/]) expect(within(ticket).getByText(t)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy WELCOME10' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Use Now/ }));
    expect(sessionStorage.getItem('playnx_coupon')).toBe('WELCOME10');
    expect(await screen.findByRole('region', { name: 'Book a turf' })).toBeInTheDocument(); // sent to book a turf on home
  });
  it('has an Expired tab that asks the server for expired offers', async () => {
    renderAt('/offers'); await screen.findByText('No offers right now');
    await userEvent.click(screen.getByRole('tab', { name: 'Expired' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/offers' && c.params?.expired === 1)).toBe(true));
  });
});

describe('payments', () => {
  it('summarises and lists transactions and refunds from the server, without inventing a wallet', async () => {
    routes['/me/payments'] = { summary: { paid_total: 1600, successful: 2, failed: 1, pending: 0 }, payments: [{ id: 'p1', transaction_id: 'pay_1', amount: 800, status: 'captured', method: 'upi', created_at: '2030-01-01T10:00:00Z', paid_at: '2030-01-01T10:01:00Z', booking_id: 'b1', reference: 'KO-1', venue_name: 'Green Arena' }], refunds: [{ id: 'r1', amount: 800, status: 'processed', created_at: '2030-01-02T10:00:00Z', processed_at: '2030-01-03T10:00:00Z', booking_id: 'b1', reference: 'KO-1', venue_name: 'Green Arena' }] };
    renderAt('/payments');
    expect(await screen.findByText('₹1,600')).toBeInTheDocument(); expect(screen.getByText('pay_1')).toBeInTheDocument(); expect(screen.getByText('Refunds')).toBeInTheDocument();
    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
  });
});

describe('my reviews', () => {
  it('writes a review with category ratings, and edits or deletes an existing one', async () => {
    routes['/me/reviews'] = { toReview: [{ booking_id: 'b9', reference: 'KO-9', venue_id: 'v1', venue_name: 'Green Arena', area_name: 'Turf A', starts_at: '2030-01-01T10:00:00Z' }], reviews: [{ id: 'r1', booking_id: 'b8', venue_id: 'v1', venue_name: 'Smash Point', rating: 4, comment: 'Nice', ground_rating: 5, owner_reply: null, created_at: '2030-01-01T10:00:00Z' }] };
    renderAt('/my-reviews');
    await userEvent.click(await screen.findByRole('button', { name: 'Write a review' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Ground quality (optional)')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Submit review' })); expect(await within(dlg).findByText('Choose an overall rating')).toBeInTheDocument();
    await userEvent.click(within(dlg).getAllByRole('radio', { name: /5/ })[0]);
    await userEvent.type(within(dlg).getByLabelText('Your review'), 'Superb');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Submit review' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/me/reviews')?.body).toMatchObject({ bookingId: 'b9', rating: 5, comment: 'Superb' }));
    window.confirm = () => true;
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/reviews/r1')).toBe(true));
  });
});

describe('settings', () => {
  it('has account, password, security, preferences and privacy; deletion goes through a support request', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Security' })).toBeInTheDocument();
    for (const h of ['Account', 'Change password', 'Preferences', 'Privacy']) expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    expect(await screen.findByText('Signed in')).toBeInTheDocument(); // login history
    expect(screen.getByText(/Two-factor authentication is not available yet/)).toBeInTheDocument(); // not pretending it exists
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark' })); expect(document.documentElement.getAttribute('data-theme')).toBe('dark'); expect(localStorage.getItem('playnx_theme')).toBe('dark'); // remembered
    window.confirm = () => true;
    await userEvent.click(screen.getByRole('button', { name: 'Request account deletion' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/me/tickets')?.body.subject).toBe('Account deletion request'));
  });
});

describe('an unpaid checkout frees the slot', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 60, sports: [{ id: 1, name: 'Football' }] }];
  const slots = [{ startsAt: '2030-01-01T14:30:00.000Z', endsAt: '2030-01-01T15:30:00.000Z', price: 800, available: true }];
  const checkout = async (error: Error & { failed?: boolean }) => {
    routes['/areas/a1/slots'] = { slots, timezone: 'Asia/Kolkata' };
    routes['POST /slots/lock'] = { lockId: 'l1', expiresAt: new Date(Date.now() + 600000).toISOString(), startsAt: slots[0].startsAt, endsAt: slots[0].endsAt, price: 800 };
    routes['POST /bookings'] = { bookingId: 'b7', total: 800, order: { id: 'order_1', amount: 800, keyId: 'rzp_test' } };
    vi.mocked(openCheckout).mockRejectedValueOnce(error);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    await userEvent.click((await screen.findAllByRole('option', { name: /pm|am/i }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: /Review & pay/ })); await userEvent.click(await screen.findByRole('button', { name: /Confirm and pay/ })); // the summary comes first
  };
  const notCompleted = (failed: boolean, message: string) => Object.assign(new Error(message), { name: 'PaymentNotCompleted', failed });

  it('releases the slot at once when the payment is declined, and says so', async () => {
    await checkout(notCompleted(true, 'Your card was declined'));
    expect(await screen.findByText(/Payment failed: Your card was declined.*slot has been released/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/bookings/b7/payment-failed')).toBe(true);
    expect(calls.some((c) => c.url === '/bookings/b7/verify-payment')).toBe(false); // never confirmed
  });

  it('releases the slot when the payment window is closed without paying', async () => {
    await checkout(notCompleted(false, 'dismissed'));
    expect(await screen.findByText(/Payment was not completed. The slot has been released/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/bookings/b7/payment-failed')).toBe(true);
  });

  it('shows a slot someone else is paying for as Booked, not Held', async () => {
    routes['/areas/a1/slots'] = { slots: [{ ...slots[0], available: false, reason: 'held' }], timezone: 'Asia/Kolkata' };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><AuthProvider><BookingWidget venueId="v1" venueName="Green Arena" areas={areas} /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
    const slot = (await screen.findAllByRole('option', { name: /pm|am/i }))[0];
    expect(slot).toHaveTextContent('Booked'); expect(slot).not.toHaveTextContent('Held'); expect(slot).toBeDisabled();
  });
});
