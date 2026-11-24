import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/maps', async (orig) => ({ ...(await orig() as any), MapView: () => null, LocationPicker: () => null }));

import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { AuthProvider } from '../src/lib/auth';
import { VenueDetailPage } from '../src/pages/customer/Discover';
import { AreasTab } from '../src/pages/owner/VenueEditor';

const wrap = (ui: React.ReactNode, path = '/') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider>{ui}</AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
const area = (id: string, name: string, over: any = {}) => ({ id, name, surface: 'Artificial grass', capacity: 14, slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }], images: [],
  pricing: [{ start_time: '06:00:00', end_time: '18:00:00', day_type: 'all', price_per_hour: '800' }, { start_time: '18:00:00', end_time: '23:00:00', day_type: 'all', price_per_hour: '1200' }],
  availability: [{ day_of_week: 1, open_time: '06:00:00', close_time: '23:00:00', is_closed: false }], ...over });
const VENUE = { id: 'v1', name: 'Turf 1', city: 'Erode', address: '123 Main St', status: 'approved', timezone: 'Asia/Kolkata', lat: 11, lng: 77, images: [], facilities: [], rating_count: 0, is_favourite: false,
  areas: [area('a1', 'Turf A', { images: [{ id: 'i1', url: 'https://x/1.jpg' }, { id: 'i2', url: 'https://x/2.jpg' }] }), area('a2', 'Court B', { pricing: [], surface: null, capacity: null })] };

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/venues/v1' ? { venue: VENUE } : url === '/venues/v1/reviews' ? { reviews: [] } : url.includes('/slots') ? { slots: [], timezone: 'Asia/Kolkata' } : {}));
});

describe('customer: playing areas as cards', () => {
  const open = async () => { wrap(<Routes><Route path="/venues/:id" element={<VenueDetailPage />} /></Routes>, '/venues/v1'); return screen.findByRole('region', { name: 'Playing areas' }); };

  it('shows one card per area with photo, capacity, sports, the lowest price and the opening hours', async () => {
    const sec = await open();
    const a = within(sec).getByRole('article', { name: 'Playing area Turf A' });
    expect(within(a).getByRole('img', { name: 'Turf A photo 1' })).toHaveAttribute('src', 'https://x/1.jpg');
    expect(a).toHaveTextContent('Artificial grass'); expect(a).toHaveTextContent('Up to 14 players'); expect(a).toHaveTextContent('60-min slots'); expect(a).toHaveTextContent('Football');
    expect(a).toHaveTextContent('From'); expect(a).toHaveTextContent('₹800'); expect(a).toHaveTextContent('₹1,200/hr'); expect(a).toHaveTextContent('06:00–23:00');
    const b = within(sec).getByRole('article', { name: 'Playing area Court B' });
    expect(within(b).queryByRole('img')).toBeNull(); expect(b).toHaveTextContent('Prices coming soon'); // no photo and no price set: honest placeholder, no invented numbers
  });

  it('flips through an area\'s photos with the dots', async () => {
    const a = within(await open()).getByRole('article', { name: 'Playing area Turf A' });
    await userEvent.click(within(a).getByRole('button', { name: 'Show photo 2' }));
    expect(within(a).getByRole('img', { name: 'Turf A photo 2' })).toHaveAttribute('src', 'https://x/2.jpg');
  });

  it('the slot box appears only after a playing area is chosen, and asks area, sport and date but no duration', async () => {
    const sec = await open();
    expect(screen.queryByLabelText('Playing area')).toBeNull(); // nothing to book yet
    expect(screen.getByLabelText('Choose a playing area')).toHaveTextContent('First choose the playing area');
    await userEvent.click(within(within(sec).getByRole('article', { name: 'Playing area Court B' })).getByRole('button', { name: 'Book this area' }));
    const box = await screen.findByLabelText('Playing area');
    expect(box).toHaveValue('a2'); expect(screen.queryByLabelText('Duration')).toBeNull();
    expect(within(sec).getByRole('button', { name: /Selected/ })).toBeInTheDocument();
    await userEvent.selectOptions(box, 'a1'); // the dropdown updates the cards
    await waitFor(() => expect(within(within(sec).getByRole('article', { name: 'Playing area Turf A' })).getByRole('button', { name: /Selected/ })).toBeInTheDocument());
  });
  it('an area can also be chosen in the box on the side', async () => {
    await open();
    await userEvent.click(within(screen.getByLabelText('Choose a playing area')).getByRole('button', { name: /Turf A/ }));
    expect(await screen.findByLabelText('Playing area')).toHaveValue('a1');
  });
});

describe('owner: playing areas as photo cards', () => {
  const sports = { sports: [{ id: 1, name: 'Football' }] };
  const ownerVenue = {
    id: 'v1', name: 'Turf 1', status: 'draft',
    images: [{ id: 'm1', url: 'https://x/a1-first.jpg', kind: 'image', area_id: 'a1' }, { id: 'm2', url: 'https://x/a1-second.jpg', kind: 'image', area_id: 'a1' }, { id: 'm3', url: 'https://x/venue.jpg', kind: 'image', area_id: null, is_cover: true }],
    areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, is_active: true, pricing: [{ id: 'p' }], availability: [{ dayOfWeek: 1, isClosed: false }] },
      { id: 'a2', name: 'Court B', sport_ids: [1], slot_minutes: 30, min_duration_minutes: 30, max_duration_minutes: 90, is_active: false, pricing: [], availability: [] }] };
  beforeEach(() => { vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/sports' ? sports : {})); });

  it('puts the area\'s own photo on its card (not the venue\'s) and keeps every action', async () => {
    wrap(<AreasTab venue={ownerVenue} />);
    const a = await screen.findByLabelText('Turf A photo');
    expect(within(a).getByRole('img', { name: /Turf A photo 1 of \d/ })).toHaveAttribute('src', 'https://x/a1-first.jpg');
    expect(within(a).getByText('2 photos')).toBeInTheDocument();
    for (const n of [/Hours & pricing/, /Block slots/]) expect(screen.getAllByRole('button', { name: n }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Pricing \(/ })).toBeNull(); expect(screen.queryByRole('button', { name: /^Operating hours \(/ })).toBeNull(); // one button replaces the two
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2); expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('an area without photos shows a placeholder and an "Add photos" shortcut that opens its form', async () => {
    wrap(<AreasTab venue={ownerVenue} />);
    const b = await screen.findByLabelText('Court B photo');
    expect(within(b).queryByRole('img')).toBeNull();
    await userEvent.click(within(b).getByRole('button', { name: '+ Add photos' }));
    expect(await screen.findByRole('dialog', { name: 'Edit Court B' })).toBeInTheDocument();
  });
});


describe('owner: Activate and Deactivate', () => {
  const venue = (active: boolean) => ({ id: 'v1', name: 'Turf 1', status: 'approved', images: [], areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, is_active: active, pricing: [], availability: [] }] });
  const calls: [string, string, any][] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/sports' ? { sports: [{ id: 1, name: 'Football' }] } : url.endsWith('/upcoming-bookings') ? { bookings: upcoming } : {}));
    vi.mocked(api.put).mockImplementation((async (url: string, body: any) => { calls.push(['PUT', url, body]); return {}; }) as any);
  });
  let upcoming: any[] = [];
  beforeEach(() => { upcoming = []; });
  it('with upcoming bookings it lists them and asks to cancel them or leave them booked', async () => {
    upcoming = [{ id: 'b1', reference: 'KO-1', starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T11:00:00Z', customer_name: 'Ravi' }];
    wrap(<AreasTab venue={venue(true)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dlg = await screen.findByRole('dialog', { name: 'Deactivate Turf A?' });
    expect(await within(dlg).findByText(/Turf A has an upcoming booking/)).toBeInTheDocument(); expect(dlg).toHaveTextContent('Ravi');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Leave the bookings, close it' }));
    await waitFor(() => expect(calls).toEqual([['PUT', '/owner/areas/a1', { isActive: false, bookings: 'keep' }]]));
  });

  it('opens a confirmation pop-up first, and only deactivates after the owner confirms', async () => {
    wrap(<AreasTab venue={venue(true)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dlg = await screen.findByRole('dialog', { name: 'Deactivate Turf A?' });
    expect(dlg).toHaveTextContent('no longer see or book'); expect(await within(dlg).findByText(/no upcoming bookings/)).toBeInTheDocument();
    expect(calls).toEqual([]); // nothing happens until they confirm
    await userEvent.click(within(dlg).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(calls).toEqual([['PUT', '/owner/areas/a1', { isActive: false }]]));
    expect(await screen.findByText(/Turf A is deactivated\. Customers can no longer see or book it/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate Turf A?' })).toBeNull()); // the pop-up closes
  });

  it('Cancel (or closing the pop-up) leaves the area active', async () => {
    wrap(<AreasTab venue={venue(true)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Deactivate Turf A?' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Deactivate Turf A?' })).toBeNull(); expect(calls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await userEvent.keyboard('{Escape}'); // Escape closes it too
    expect(screen.queryByRole('dialog', { name: 'Deactivate Turf A?' })).toBeNull(); expect(calls).toEqual([]);
  });

  it('an inactive area is clearly marked, and Activate works straight away without a question', async () => {
    wrap(<AreasTab venue={venue(false)} />);
    expect(await screen.findByText('Inactive · hidden from customers')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(calls).toEqual([['PUT', '/owner/areas/a1', { isActive: true }]]));
    expect(screen.queryByRole('dialog')).toBeNull(); // no question for activating
    expect(await screen.findByText(/Turf A is active again/)).toBeInTheDocument();
  });

  it('shows the reason when the server refuses (for example the venue is under approval)', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { data: { error: { message: 'This venue is under approval and cannot be changed' } } } });
    wrap(<AreasTab venue={venue(true)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Deactivate Turf A?' })).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('This venue is under approval and cannot be changed')).toBeInTheDocument();
  });
});

describe('owner: the single Hours & pricing button', () => {
  it('opens one window that holds both the opening hours and the slot prices', async () => {
    const v = { id: 'v1', name: 'Turf 1', status: 'approved', images: [], areas: [{ id: 'a1', name: 'Turf A', sport_ids: [1], slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, is_active: true,
      pricing: [{ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '08:00', pricePerHour: 800 }], availability: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '08:00', isClosed: false })) }] };
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/sports' ? { sports: [{ id: 1, name: 'Football' }] } : {}));
    wrap(<AreasTab venue={v} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Hours & pricing (7 days open)' }));
    const dlg = await screen.findByRole('dialog', { name: 'Hours & pricing · Turf A' });
    expect(within(dlg).getByLabelText('Sunday opens hour')).toBeInTheDocument(); // opening hours
    expect(within(dlg).getByLabelText('6:00 AM price')).toHaveValue(800); // and the price under the 6:00 AM slot
  });
});

describe('customer: the venue\'s contact number on the turf page', () => {
  const page = (venue: any) => {
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/venues/v1' ? { venue } : url === '/venues/v1/reviews' ? { reviews: [] } : url.includes('/slots') ? { slots: [], timezone: 'Asia/Kolkata' } : {}));
    wrap(<Routes><Route path="/venues/:id" element={<VenueDetailPage />} /></Routes>, '/venues/v1');
  };
  it('shows the main contact number as a call link', async () => {
    page({ ...VENUE, contact_phone: '+919800000001' });
    expect(await screen.findByRole('link', { name: /\+919800000001/ })).toHaveAttribute('href', 'tel:+919800000001');
  });
  it('never shows a second number to customers, even if one were sent', async () => {
    page({ ...VENUE, contact_phone: '+919800000001', contact_phone2: '+919800000002' });
    expect(await screen.findByRole('link', { name: /\+919800000001/ })).toBeInTheDocument();
    expect(screen.queryByText(/\+919800000002/)).toBeNull(); expect(screen.queryAllByRole('link', { name: /📞/ })).toHaveLength(1);
  });
});
