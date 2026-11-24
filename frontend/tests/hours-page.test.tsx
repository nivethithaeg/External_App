import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { HoursPage, PricingPage } from '../src/pages/owner/OwnerOps';

const hours = (open: [number, string, string][]) => Array.from({ length: 7 }, (_, d) => { const o = open.find((x) => x[0] === d); return o ? { dayOfWeek: d, openTime: o[1], closeTime: o[2], isClosed: false } : { dayOfWeek: d, openTime: '06:00', closeTime: '23:00', isClosed: true }; });
const area = (id: string, name: string, venue_id: string, over: any = {}) => ({ id, name, venue_id, slot_minutes: 60, surface: 'Grass', is_active: true, sport_ids: [1], pricing: [], availability: [], ...over });
const TURF_A = area('a1', 'Turf A', 'v1', { availability: hours([1, 2, 3, 4, 5, 6].map((d) => [d, '06:00', '09:00'] as [number, string, string])), pricing: [{ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '09:00', pricePerHour: 500 }] });
const COURT_B = area('a2', 'Court B', 'v1', { slot_minutes: 30, surface: null, availability: hours([[1, '06:00', '07:00']]), pricing: [] });
const VENUES = [{ id: 'v1', name: 'Green Arena', city: 'Bengaluru' }, { id: 'v2', name: 'Second Arena', city: 'Chennai' }];
const DETAIL: Record<string, any> = {
  v1: { id: 'v1', name: 'Green Arena', city: 'Bengaluru', locality: 'Indiranagar', status: 'approved', areas: [TURF_A, COURT_B] },
  v2: { id: 'v2', name: 'Second Arena', city: 'Chennai', locality: null, status: 'approved', areas: [area('a3', 'Field 1', 'v2', { availability: hours([[0, '07:00', '10:00']]), pricing: [{ sportId: null, dayType: 'weekend', dayOfWeek: null, startTime: '07:00', endTime: '10:00', pricePerHour: 900 }, { sportId: null, dayType: 'all', dayOfWeek: 0, startTime: '07:00', endTime: '08:00', pricePerHour: 1200 }] })] },
  v3: { id: 'v3', name: 'Empty Arena', city: 'Pune', status: 'draft', areas: [] },
};
let venues = VENUES;

beforeEach(() => {
  vi.clearAllMocks(); venues = VENUES;
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/owner/venues') return { venues };
    if (url === '/sports') return { sports: [{ id: 1, name: 'Football' }] };
    const m = /^\/owner\/venues\/(v\d)$/.exec(url); return m ? { venue: DETAIL[m[1]] } : {};
  });
});
const open = (path = '/owner/hours') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><HoursPage /></MemoryRouter></ToastProvider></QueryClientProvider>);
const day = (card: HTMLElement, d: string) => within(card).getAllByRole('listitem').find((li) => li.querySelector('.font-semibold')?.textContent === d)!;

describe('Operating hours: choose a venue, see its playing areas and their schedule', () => {
  it('always offers a venue picker, even when the owner has only one venue', async () => {
    venues = [VENUES[0]];
    open();
    expect(await screen.findByLabelText('Venue')).toBeInTheDocument();
    expect(await screen.findByLabelText('Schedule of Turf A')).toBeInTheDocument();
  });

  it('shows the chosen venue\'s name and its playing areas, each with its weekly schedule', async () => {
    open();
    const sel = await screen.findByLabelText('Venue');
    expect(sel).toHaveValue('v1');
    expect(await screen.findByText('Green Arena')).toBeInTheDocument(); expect(screen.getByText(/Indiranagar, Bengaluru · 2 playing areas/)).toBeInTheDocument();
    const turf = screen.getByLabelText('Schedule of Turf A');
    expect(turf).toHaveTextContent('60-minute slots · Grass');
    const mon = day(turf, 'Mon'); expect(mon).toHaveTextContent('6:00 AM to 9:00 AM'); expect(mon).toHaveTextContent('3 slots'); expect(mon).toHaveTextContent('₹500 / slot'); // an hour slot at ₹500 an hour
    expect(day(turf, 'Sun')).toHaveTextContent('Closed');
    expect(screen.getByLabelText('Schedule of Court B')).toBeInTheDocument();
  });

  it('prices a 30-minute slot as half an hour, and flags open slots that have no price', async () => {
    open();
    const court = await screen.findByLabelText('Schedule of Court B');
    const mon = day(court, 'Mon'); expect(mon).toHaveTextContent('2 slots'); expect(mon).toHaveTextContent('2 unpriced'); expect(mon).not.toHaveTextContent('/ slot');
    expect(court).toHaveTextContent('30-minute slots');
  });

  it('switching the venue shows only that venue\'s playing areas and schedule', async () => {
    open();
    await userEvent.selectOptions(await screen.findByLabelText('Venue'), 'v2');
    const field = await screen.findByLabelText('Schedule of Field 1');
    expect(screen.queryByLabelText('Schedule of Turf A')).toBeNull(); expect(screen.queryByLabelText('Schedule of Court B')).toBeNull();
    expect(screen.getByText('Second Arena')).toBeInTheDocument();
    const sun = day(field, 'Sun'); expect(sun).toHaveTextContent('7:00 AM to 10:00 AM'); expect(sun).toHaveTextContent('3 slots');
    expect(sun).toHaveTextContent('₹900–₹1,200 / slot'); // the Sunday-only rule (1,200) and the weekend rule (900): a range
    expect(screen.queryByLabelText('Playing area')).toBeNull(); // one area: nothing to choose between
  });

  it('with several areas, one can be picked to look at on its own', async () => {
    open();
    const pick = await screen.findByLabelText('Playing area');
    await userEvent.selectOptions(pick, 'a2');
    expect(screen.getByLabelText('Schedule of Court B')).toBeInTheDocument(); expect(screen.queryByLabelText('Schedule of Turf A')).toBeNull();
    await userEvent.selectOptions(pick, '');
    expect(screen.getByLabelText('Schedule of Turf A')).toBeInTheDocument(); expect(screen.getByLabelText('Schedule of Court B')).toBeInTheDocument();
  });

  it('opens on the venue named in the link', async () => {
    open('/owner/hours?venue=v2');
    expect(await screen.findByLabelText('Venue')).toHaveValue('v2'); expect(await screen.findByLabelText('Schedule of Field 1')).toBeInTheDocument();
  });

  it('says so when the chosen venue has no playing areas, with a way to add one', async () => {
    venues = [...VENUES, { id: 'v3', name: 'Empty Arena', city: 'Pune' }];
    open('/owner/hours?venue=v3');
    expect(await screen.findByText('No playing areas')).toBeInTheDocument(); expect(screen.getByText(/Empty Arena has no playing areas yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add area' })).toHaveAttribute('href', '/owner/areas?venue=v3');
  });

  it('"Edit opening hours" opens the JusGo editor: default price, day-wise hours and optional date-wise hours', async () => {
    open();
    const court = await screen.findByLabelText('Schedule of Court B');
    await userEvent.click(within(court).getByRole('button', { name: 'Edit opening hours' }));
    const dlg = await screen.findByRole('dialog', { name: 'Opening hours · Court B' });
    for (const t of ['Default price', 'Day-wise hours', 'Date-wise hours']) expect(within(dlg).getByRole('heading', { name: new RegExp(t) })).toBeInTheDocument();
    expect(within(dlg).getByLabelText(/Default price \(₹ per hour\)/)).toBeInTheDocument();
    expect(within(dlg).getAllByRole('switch', { name: '24 hours' }).length).toBeGreaterThan(0); expect(within(dlg).getAllByRole('button', { name: 'Same for all days' })).toHaveLength(7);
    expect(within(dlg).getByText('No special dates.')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: '+ Add date' }));
    expect(within(dlg).getByLabelText('Date')).toBeInTheDocument(); expect(within(dlg).getByRole('switch', { name: 'Closed all day' })).toBeChecked(); expect(within(dlg).getByPlaceholderText('e.g. Pongal holiday')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save opening hours' }));
    expect(await within(dlg).findByText('Pick the date.')).toBeInTheDocument(); // nothing is sent until it is valid
  });

  it('an area with no hours at all says customers cannot book it', async () => {
    DETAIL.v1.areas = [area('a9', 'New Turf', 'v1')];
    open();
    expect(await screen.findByText(/No hours set. Customers can't book this area/)).toBeInTheDocument();
    DETAIL.v1.areas = [TURF_A, COURT_B];
  });
});

describe('Pricing: Default pricing or Slot wise pricing, like JusGo', () => {
  beforeEach(() => { const base = vi.mocked(api.get).getMockImplementation()!; vi.mocked(api.get).mockImplementation(async (url: string, ...rest: any[]) => (url === '/owner/pricing/history' ? { history: [] } : /price-adjustments$/.test(url) ? { adjustments: [] } : (base as any)(url, ...rest))); });
  const openPricing = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={['/owner/pricing']}><PricingPage /></MemoryRouter></ToastProvider></QueryClientProvider>);
  it('asks for the venue, then the playing area, and shows only that area', async () => {
    openPricing();
    expect(await screen.findByLabelText(/Select venue/)).toBeInTheDocument();
    const pick = await screen.findByLabelText(/Select playing area/);
    expect(screen.getAllByLabelText(/^Pricing of /)).toHaveLength(1);
    expect(screen.getByLabelText(`Pricing of ${(pick as HTMLSelectElement).selectedOptions[0].textContent}`)).toBeInTheDocument();
  });
  it('shows the default price with the slot prices; changing it keeps the prices set for particular slots', async () => {
    openPricing();
    const card = await screen.findByLabelText('Pricing of Turf A');
    expect(within(card).getByText('How do you want to price Turf A?')).toBeInTheDocument();
    expect(within(card).getByRole('radio', { name: /2\. Slot wise pricing/ })).toBeChecked(); // it already has day and time prices
    expect(within(card).getByText(/Prices you set for particular slots stay and are used for those slots/)).toBeInTheDocument(); // the default price is there too
    await userEvent.click(within(card).getByRole('button', { name: /Set default price|Change default price/ }));
    expect(await within(card).findByText('Enter the default price (more than 0).')).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(within(card).getByLabelText(/Default price \(₹ per hour\)/), '700');
    await userEvent.click(within(card).getByRole('button', { name: /Set default price|Change default price/ }));
    expect(screen.queryByRole('dialog', { name: 'Replace the other prices?' })).toBeNull();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/areas/a1/default-price', { basePrice: 700, applyToAll: false }));
  });
  it('slot wise pricing also has prices for chosen dates, and a price preview of a day', async () => {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url: string, ...rest: any[]) => (/\/date-prices$/.test(url) ? { prices: [{ id: 'p1', date: '2030-01-05', startTime: '10:00', endTime: '12:00', pricePerHour: 1500 }] } : /\/areas\/a1\/slots$/.test(url) ? { slots: [{ startsAt: '2030-01-05T04:30:00.000Z', endsAt: '2030-01-05T05:30:00.000Z', price: 1500 }, { startsAt: '2030-01-05T05:30:00.000Z', endsAt: '2030-01-05T06:30:00.000Z', price: null }] } : (base as any)(url, ...rest)));
    openPricing();
    const card = await screen.findByLabelText('Pricing of Turf A');
    const dates = await within(card).findByLabelText('Prices for chosen dates');
    expect(within(dates).getByText('₹1,500/hr')).toBeInTheDocument();
    await userEvent.click(within(dates).getByRole('button', { name: 'Save date price' }));
    expect(await within(dates).findByText('Choose the date.')).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(within(dates).getByLabelText('Price date'), '2030-02-01'); await userEvent.type(within(dates).getByLabelText('Price per hour (₹)'), '1800');
    await userEvent.click(within(dates).getByRole('button', { name: 'Save date price' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/areas/a1/date-prices', { entries: [{ date: '2030-02-01', startTime: '06:00', endTime: '23:00', pricePerHour: 1800 }] }));
    const preview = within(card).getByLabelText('Price preview');
    expect(await within(preview).findByText('Price not set')).toBeInTheDocument(); expect(within(preview).getByText(/Some times have no price/)).toBeInTheDocument();
  });
});
