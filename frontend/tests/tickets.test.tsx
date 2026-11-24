import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { TicketThread } from '../src/pages/customer/Account';

const open = (admin: boolean) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter>
  <TicketThread id="t1" base={admin ? '/admin/tickets' : '/me/tickets'} admin={admin} onClose={() => {}} /></MemoryRouter></ToastProvider></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ ticket: { id: 't1', subject: 'Refund not received', status: 'open' }, messages: [{ id: 'm1', author: 'Asha', author_role: 'customer', body: 'Please check my refund', created_at: '2030-01-01T05:00:00Z' }] });
  vi.mocked(api.post).mockResolvedValue({});
});

describe('ticket reply box', () => {
  it('is optional for an admin: the button reads "Update status" and sends only the status', async () => {
    open(true);
    const box = await screen.findByLabelText('Reply (optional)');
    expect(box).not.toBeRequired();
    await userEvent.selectOptions(screen.getByLabelText('Set status'), 'resolved');
    await userEvent.click(screen.getByRole('button', { name: 'Update status' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/tickets/t1/reply', { status: 'resolved' }));
  });
  it('sends the message with the status once the admin types one, and the button says "Send"', async () => {
    open(true);
    await userEvent.type(await screen.findByLabelText('Reply (optional)'), 'Refund is on its way');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/tickets/t1/reply', { message: 'Refund is on its way', status: 'in_progress' }));
  });
  it('stays required for the customer', async () => {
    open(false);
    expect(await screen.findByLabelText('Reply')).toBeRequired();
    expect(screen.queryByLabelText('Reply (optional)')).toBeNull();
  });
});

describe('refunding from a complaint', () => {
  it('with no booking on the ticket, the admin picks one of the customer paid bookings, then refunds it', async () => {
    vi.mocked(api.get).mockResolvedValue({ ticket: { id: 't1', subject: 'not clean', status: 'open' }, messages: [], booking: null,
      bookings: [{ id: 'b1', reference: 'KO-1', venue_name: 'Turf 1', area_name: 'Turf A', starts_at: '2030-01-01T10:00:00Z', paid: 1000, refunded: 0, refundable: 1000 }] } as any);
    vi.mocked(api.post).mockResolvedValue({ refund: { amount: 1000 } } as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open(true);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /^Booking/ }), 'b1');
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Turf was not cleaned');
    await userEvent.click(screen.getByRole('button', { name: 'Refund and resolve' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/tickets/t1/refund', { reason: 'Turf was not cleaned', bookingId: 'b1' }));
  });
});
