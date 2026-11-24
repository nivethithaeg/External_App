import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { money, durationLabel, statusTone, fmtTime } from '../src/lib/utils';
import { apiError } from '../src/lib/api';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/razorpay', () => ({ openCheckout: vi.fn(), isPaymentNotCompleted: (e: any) => e?.name === 'PaymentNotCompleted' }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import { LoginPage, RegisterPage } from '../src/pages/auth/AuthPages';
import { BookingWidget } from '../src/components/BookingWidget';

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);
};
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('utils', () => {
  it('formats money in INR', () => { expect(money(1200)).toContain('1,200'); expect(money(99.5)).toContain('99.50'); });
  it('labels durations', () => { expect(durationLabel(60)).toBe('1 hr'); expect(durationLabel(90)).toBe('1 hr 30 min'); });
  it('maps statuses to tones', () => { expect(statusTone('confirmed')).toBe('ok'); expect(statusTone('failed')).toBe('danger'); expect(statusTone('pending')).toBe('warn'); });
  it('renders times in the venue timezone', () => { expect(fmtTime('2026-01-01T12:30:00Z', 'Asia/Kolkata')).toMatch(/6:00/); });
  it('extracts API validation messages', () => {
    expect(apiError({ response: { data: { error: { code: 'validation_error', message: 'x', details: [{ path: 'email', message: 'bad' }] } } } })).toBe('email: bad');
    expect(apiError({ message: 'Network Error' })).toMatch(/Cannot reach/);
  });
});

describe('auth pages', () => {
  it('shows an inline error and keeps the form when login is rejected', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { error: { message: 'Incorrect email or password' } } } });
    wrap(<LoginPage portal="customer" />);
    await userEvent.type(screen.getByLabelText('Email or mobile number'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
  });
  it('requires both fields before calling the API', async () => {
    wrap(<LoginPage portal="customer" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your email or mobile/i);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('validates registration client-side (weak password)', async () => {
    wrap(<RegisterPage portal="owner" />);
    await userEvent.type(screen.getByLabelText(/First name/), 'Asha');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@x.co');
    await userEvent.type(screen.getByLabelText(/Mobile number/), '9876543210');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'other');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/At least 8 characters/)).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByText(/Accept the Terms/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('BookingWidget', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }] }];
  const slots = [
    { startsAt: '2030-01-01T04:30:00.000Z', endsAt: '2030-01-01T05:30:00.000Z', price: 800, available: true },
    { startsAt: '2030-01-01T05:30:00.000Z', endsAt: '2030-01-01T06:30:00.000Z', price: 800, available: false, reason: 'booked' },
  ];
  it('lists slots, disables taken ones, and prompts anonymous users to log in', async () => {
    vi.mocked(api.get).mockResolvedValue({ slots, timezone: 'Asia/Kolkata' });
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />);
    const options = await screen.findAllByRole('option', { name: /AM|PM/i });
    expect(options.length).toBeGreaterThanOrEqual(2);
    const taken = options.find((o) => o.textContent?.includes('Booked'))!;
    expect(taken).toBeDisabled();
    await userEvent.click(options.find((o) => !(o as HTMLButtonElement).disabled)!);
    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log in to book/ })).toBeEnabled();
  });
  it('shows an error state with retry when slots fail to load', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { data: { error: { message: 'Server exploded' } } } });
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />);
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
  });
});

describe('BookingWidget: only slots that can still be booked are listed', () => {
  const areas = [{ id: 'a1', name: 'Turf A', slot_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, sports: [{ id: 1, name: 'Football' }] }];
  const mk = (h: number, extra: any = {}) => ({ startsAt: `2030-01-01T${String(h).padStart(2, '0')}:00:00.000Z`, endsAt: `2030-01-01T${String(h + 1).padStart(2, '0')}:00:00.000Z`, price: 400, available: true, ...extra });
  it('hides slots that already started and slots with no price, but keeps booked ones as taken', async () => {
    vi.mocked(api.get).mockResolvedValue({ timezone: 'UTC', slots: [mk(1, { available: false, reason: 'past', price: null }), mk(2, { available: false, reason: 'unpriced', price: null }), mk(3, { available: false, reason: 'booked' }), mk(4), mk(5)] });
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />);
    const list = await screen.findByRole('listbox', { name: 'Time slots' });
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(screen.queryByText('Passed')).toBeNull(); expect(screen.queryByText('N/A')).toBeNull();
    expect(screen.getByText('Booked')).toBeInTheDocument();
  });
  it('says the sport has no price yet, instead of "no more slots", when the remaining slots are unpriced', async () => {
    vi.mocked(api.get).mockResolvedValue({ timezone: 'UTC', slots: [mk(1, { available: false, reason: 'past', price: null }), mk(2, { available: false, reason: 'unpriced', price: null })] });
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />);
    expect(await screen.findByText(/Football is not open for booking on .* yet, because the venue has not set a price/)).toBeInTheDocument();
  });
  it('says so when every slot today has passed', async () => {
    vi.mocked(api.get).mockResolvedValue({ timezone: 'UTC', slots: [mk(1, { available: false, reason: 'past', price: null })] });
    wrap(<BookingWidget venueId="v1" venueName="Green Arena" areas={areas} />);
    expect(await screen.findByText(/No more slots left on/)).toBeInTheDocument();
  });
});

