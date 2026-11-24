import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), apiError: (e: any) => String(e?.message ?? e), api: {} }));
import * as api from '../src/lib/api';
import { DeleteBookingModal, EditBookingModal } from '../src/pages/owner/BookingEdit';

const FUTURE = new Date(Date.now() + 5 * 86400000); FUTURE.setUTCHours(10, 0, 0, 0);
const iso = (h = 0) => new Date(FUTURE.getTime() + h * 3600000).toISOString();
const booking = (over: any = {}) => ({ id: 'b1', reference: 'KO-ABC123', status: 'confirmed', starts_at: iso(), ends_at: iso(1), timezone: 'Asia/Kolkata', area_id: 'a1', sport_id: 1, area_name: 'Turf A', venue_name: 'Green Arena', area_environment: 'indoor',
  customer_name: 'Ravi Kumar', walkin_phone: '+919876543210', walkin_city: 'Erode', booking_notes: '', total: 800, amount_paid: 300, opponent1_name: null, refund_amount: 0, refund_mode: null, ...over });
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ slots: [{ startsAt: iso(), endsAt: iso(1), price: 800, available: false }, { startsAt: iso(3), endsAt: iso(4), price: 900, available: true }] });
  vi.mocked(api.patch).mockResolvedValue({ updated: true }); vi.mocked(api.post).mockResolvedValue({ restored: true }); vi.mocked(api.del).mockResolvedValue({});
});

describe('Edit booking (JusGo)', () => {
  it('shows the sections, checks the customer, and sends only what changed', async () => {
    const saved = vi.fn();
    wrap(<EditBookingModal b={booking()} onClose={() => undefined} onSaved={saved} />);
    expect(await screen.findByRole('dialog', { name: 'Edit booking KO-ABC123' })).toBeInTheDocument();
    for (const t of ['Date and slot', 'Customer details', 'Amount']) expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();
    expect(screen.getByText('Turf A')).toBeInTheDocument(); expect(screen.queryByText('Opponent details')).not.toBeInTheDocument(); // an indoor area has no opponents
    expect(screen.getByLabelText(/Customer name/)).toHaveValue('Ravi Kumar');
    await userEvent.clear(screen.getByLabelText(/Customer mobile/)); await userEvent.type(screen.getByLabelText(/Customer mobile/), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/valid 10-digit mobile number/)).toBeInTheDocument(); expect(api.patch).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/Customer mobile/)); await userEvent.type(screen.getByLabelText(/Customer mobile/), '9876543211');
    await userEvent.type(screen.getByLabelText(/^Note/), 'birthday');
    await userEvent.clear(screen.getByLabelText('Amount (₹)')); await userEvent.type(screen.getByLabelText('Amount (₹)'), '700');
    await userEvent.selectOptions(screen.getByLabelText(/Payment status/), 'partial'); await userEvent.type(screen.getByLabelText(/Initial payment/), '300'); await userEvent.selectOptions(screen.getByLabelText(/Mode of payment/), 'online');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/owner/bookings/b1', expect.objectContaining({ customerName: 'Ravi Kumar', customerPhone: '9876543211', customerCity: 'Erode', note: 'birthday', price: 700, payment: { status: 'partial', amountPaid: 300, mode: 'online' } })));
    expect(saved).toHaveBeenCalledWith('Booking KO-ABC123 updated.');
  });

  it('moves an upcoming booking to another free slot', async () => {
    wrap(<EditBookingModal b={booking()} onClose={() => undefined} onSaved={() => undefined} />);
    const slot = await screen.findByRole('option', { name: /900/ });
    await userEvent.click(slot); expect(await screen.findByText('(changed)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/owner/bookings/b1', expect.objectContaining({ startsAt: iso(3) })));
  });

  it('on an open ground it also asks both opponents', async () => {
    wrap(<EditBookingModal b={booking({ area_environment: 'outdoor' })} onClose={() => undefined} onSaved={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'Opponent details' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("Enter Opponent 1's name")).toBeInTheDocument(); expect(api.patch).not.toHaveBeenCalled();
  });

  it('a cancelled booking can have its cancellation removed, and a refund recorded', async () => {
    const saved = vi.fn();
    wrap(<EditBookingModal b={booking({ status: 'cancelled', cancel_reason: 'Customer called' })} onClose={() => undefined} onSaved={saved} />);
    expect(await screen.findByText('This booking is cancelled')).toBeInTheDocument(); expect(screen.getByText(/Reason: Customer called/)).toBeInTheDocument();
    expect(screen.getByText(/Refund · the customer paid ₹300/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Refund amount/)); await userEvent.type(screen.getByLabelText(/Refund amount/), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/cannot be more than the ₹300 paid/)).toBeInTheDocument(); expect(api.patch).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/Refund amount/)); await userEvent.type(screen.getByLabelText(/Refund amount/), '300'); await userEvent.selectOptions(screen.getByLabelText(/Mode of refund/), 'offline');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/owner/bookings/b1', expect.objectContaining({ refund: { amount: 300, mode: 'offline' } })));
    await userEvent.click(screen.getByRole('button', { name: 'Remove cancellation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove cancellation' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/bookings/b1/restore'));
  });
});

describe('Delete booking (JusGo)', () => {
  it('asks for an optional reason and deletes', async () => {
    const gone = vi.fn();
    wrap(<DeleteBookingModal b={booking()} onClose={() => undefined} onDeleted={gone} />);
    expect(await screen.findByRole('dialog', { name: 'Delete booking KO-ABC123?' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Entered twice');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/owner/bookings/b1', { reason: 'Entered twice' }));
    expect(gone).toHaveBeenCalledWith('Booking KO-ABC123 deleted.');
  });
});
