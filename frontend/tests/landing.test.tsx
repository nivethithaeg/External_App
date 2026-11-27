import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
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

const SPORTS = [{ id: 1, name: 'Football', slug: 'football' }, { id: 2, name: 'Cricket', slug: 'cricket' }, { id: 3, name: 'Badminton', slug: 'badminton' }, { id: 9, name: 'Hockey', slug: 'hockey' }];
const VENUE = { id: 'v1', name: 'Green Arena', city: 'Bengaluru', address: '12 Park Rd', rating_avg: 4.5, rating_count: 2, min_price: 800, cover_image: 'https://img.test/a.jpg', sports: ['Football'], is_favourite: false };
let reviews: any[] = [];

function mockApi() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/sports') return { sports: SPORTS };
    if (url === '/banners') return { banners: [] };
    if (url === '/cities') return { cities: [{ city: 'Bengaluru', venues: 1 }] };
    if (url === '/venues') return { venues: [VENUE], total: 1, limit: 12 };
    if (url === '/reviews/featured') return { reviews };
    if (/^\/venues\/[^/]+\/reviews$/.test(url)) return { reviews: [] };
    if (/^\/venues\/[^/]+$/.test(url)) return { venue: { ...VENUE, lat: 12.9, lng: 77.6, timezone: 'Asia/Kolkata', images: [], facilities: [], areas: [] } };
    return {};
  });
}
const renderAt = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
};
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); reviews = []; mockApi(); });

describe('landing page (logged out)', () => {
  it('is the first page: what players and venue owners can do, without login', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Both sides/ })).toBeInTheDocument();
    for (const t of [/I want to play/i, /I run a venue/i, /built so nothing gets double booked/i, /got questions\? we have answers/i, /already with/i]) {
      expect(await screen.findByRole('heading', { name: t })).toBeInTheDocument();
    }
    // the switch shows the player side first, then the venue owner side
    expect(screen.getByRole('heading', { name: /What you can do as a player/i })).toBeInTheDocument();
    for (const f of ['Live slots, real prices', 'Pay safely online', 'Cancel and get refunds']) expect(screen.getByRole('heading', { name: f })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Venue owner' }));
    expect(screen.getByRole('heading', { name: /What you can do as a venue owner/i })).toBeInTheDocument();
    for (const f of ['Your hours, your prices', 'Full or advance payment', 'Automatic payouts', 'Staff logins']) expect(screen.getByRole('heading', { name: f })).toBeInTheDocument();
    screen.getAllByRole('link', { name: /Register your venue/ }).forEach((a) => expect(a).toHaveAttribute('href', '/owner/register'));
    screen.getAllByRole('link', { name: /Book a game/ }).forEach((a) => expect(a).toHaveAttribute('href', '/home'));
  });

  it('hides testimonials when there are no reviews and shows real ones when there are', async () => {
    const { unmount } = renderAt('/');
    await screen.findByRole('heading', { name: /I want to play/i });
    expect(screen.queryByText(/Players Love PlaynX/i)).not.toBeInTheDocument();
    unmount();
    reviews = [{ id: 'r1', rating: 5, comment: 'Brilliant surface and lights', author: 'Asha K.', venue_id: 'v1', venue_name: 'Green Arena' }];
    renderAt('/');
    expect(await screen.findByText(/Brilliant surface and lights/)).toBeInTheDocument();
    expect(screen.getByText('Asha K.')).toBeInTheDocument();
  });

  it('FAQ is an accordion: one open at a time, toggled by keyboard-accessible buttons', async () => {
    renderAt('/');
    const first = await screen.findByRole('button', { name: /What is PlaynX\?/i });
    const second = screen.getByRole('button', { name: /How can I book a turf\?/i });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'false');
  });

  it('owner section buttons point at the existing owner routes', async () => {
    renderAt('/');
    const reg = await screen.findAllByRole('link', { name: /Register your venue|List your venue/ });
    reg.forEach((a) => expect(a).toHaveAttribute('href', '/owner/register'));
    screen.getAllByRole('link', { name: 'Owner login' }).forEach((a) => expect(a).toHaveAttribute('href', '/owner/login'));
  });

  it('the booking page has the filters (city, sport) and the venue choice to book, and no search box', async () => {
    renderAt('/book');
    await screen.findByRole('button', { name: /Green Arena/ });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    const book = screen.getByRole('region', { name: 'Book a turf' });
    for (const l of [/^City/, /^Sport/, /^Date/]) expect(within(book).getByLabelText(l)).toBeInTheDocument();
    expect(within(book).getByRole('button', { name: 'Filter' })).toBeInTheDocument(); expect(within(book).queryByLabelText(/Select venue/)).toBeNull(); // no venue box: the turfs show as cards
  });

  it('every link on the page leads to a real route (no 404s)', async () => {
    const { container, unmount } = renderAt('/');
    await screen.findByRole('heading', { name: /I want to play/i });
    const hrefs = [...new Set([...container.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')!.split('?')[0]))];
    expect(hrefs.length).toBeGreaterThan(10);
    unmount();
    for (const h of hrefs) {
      const view = renderAt(h);
      await waitFor(() => expect(view.container.textContent).not.toMatch(/out of bounds/), { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 30));
      expect(view.container.textContent, `route ${h}`).not.toMatch(/out of bounds/);
      view.unmount();
    }
  });
});

describe('back arrow', () => {
  it('shows on inner pages, not on the home page, and goes home when the page was opened directly', async () => {
    renderAt('/help');
    const back = await screen.findByRole('button', { name: 'Go back' });
    await userEvent.click(back);
    expect(await screen.findByRole('heading', { name: /I want to play/i })).toBeInTheDocument(); // the landing page
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });
  it('a visitor on the booking page (/home) can go back to the landing page', async () => {
    renderAt('/home');
    await userEvent.click(await screen.findByRole('button', { name: 'Go back' }));
    expect(await screen.findByRole('heading', { name: /I want to play/i })).toBeInTheDocument();
  });
});

describe('footer & info pages', () => {
  it('footer has the four customer sections, with real links, and no owner or admin links', async () => {
    renderAt('/');
    const footer = (await screen.findAllByRole('contentinfo'))[0];
    const href = (name: string) => within(footer).getByRole('link', { name }).getAttribute('href');
    for (const [name, to] of [['Book a turf', '/home#book'], ['Sports Categories', '/sports'], ['Help Centre', '/help'], ['Contact Us', '/contact'], ['FAQs', '/help'], ['Cancellation & Refunds', '/cancellation-policy'], ['Terms & Conditions', '/terms'], ['Privacy Policy', '/privacy'], ['Cookie Policy', '/cookies'], ['Refund Policy', '/cancellation-policy']]) expect(href(name)).toBe(to);
    for (const h of ['Explore', 'My Account', 'Customer Support', 'Legal']) expect(within(footer).getByRole('heading', { name: h })).toBeInTheDocument();
    expect(footer).toHaveTextContent(/Play\s*•\s*Experience\s*•\s*Repeat/); expect(within(footer).getByText(/Made for the love of/)).toBeInTheDocument();
    for (const gone of [/Turf owners/i, /Venue owner portal/i, /Register your turf/i, /Owner login/i, /^Admin$/]) expect(within(footer).queryByText(gone)).toBeNull();
    expect(within(footer).queryByRole('link', { name: /admin/i })).toBeNull();
    expect(href('Log in')).toBe('/login'); // signed out: sign-in links are offered in My Account
    expect(within(footer).queryByLabelText('Social media')).not.toBeInTheDocument(); // none configured, so no empty icons
  });
  it('cancellation policy page matches the implemented refund rules', async () => {
    renderAt('/cancellation-policy');
    expect(await screen.findByRole('heading', { name: /cancellation policy/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/full refund/i)).toBeInTheDocument();
  });
});

describe('PlaynX contact details', () => {
  it('the Contact page and the footer show the support email and phone as links', async () => {
    renderAt('/contact');
    expect(await screen.findByRole('heading', { name: /contact us/i, level: 1 })).toBeInTheDocument();
    for (const l of screen.getAllByRole('link', { name: /playnx\.official@gmail\.com/ })) expect(l).toHaveAttribute('href', 'mailto:playnx.official@gmail.com');
    for (const l of screen.getAllByRole('link', { name: /\+91 90958 21333/ })) expect(l).toHaveAttribute('href', 'tel:+919095821333');
    const footer = (await screen.findAllByRole('contentinfo'))[0];
    expect(within(footer).getByRole('link', { name: /playnx\.official@gmail\.com/ })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: /\+91 90958 21333/ })).toBeInTheDocument();
  });
});
