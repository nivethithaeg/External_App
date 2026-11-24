import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), apiError: (e: any) => String(e?.message ?? e), api: {} }));
import * as api from '../src/lib/api';
import { SlotsPage } from '../src/pages/owner/OwnerSchedule';

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ areas: [{ id: 'a1', name: 'Turf A', venue_name: 'Green Arena' }] });
  vi.mocked(api.post).mockResolvedValue({ created: 3, conflicts: [], cancelled: 1 });
});
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><SlotsPage /></MemoryRouter></QueryClientProvider>);

describe('Slot management: event blocks over several days', () => {
  it('sends the date range, chosen weekdays, the event customer and amount, and the cancel option', async () => {
    wrap();
    await userEvent.click(await screen.findByRole('button', { name: /Turf A/ }));
    await userEvent.type(screen.getByLabelText(/^End date/), '2030-01-20');
    await userEvent.click(screen.getByRole('button', { name: 'Sat' })); await userEvent.click(screen.getByRole('button', { name: 'Sun' }));
    await userEvent.selectOptions(screen.getByLabelText(/^Reason/), 'Private event'); // an event: who is paying, how much
    await userEvent.click(screen.getByRole('button', { name: /Apply to 1 area/ }));
    expect(api.post).not.toHaveBeenCalled(); // an event needs the customer first
    await userEvent.type(screen.getByLabelText(/^Customer name/), 'Acme Corp'); await userEvent.type(screen.getByLabelText(/^Customer mobile/), '9876543210');
    await userEvent.type(screen.getByLabelText(/^Amount for the event/), '5000');
    await userEvent.click(screen.getByLabelText(/Cancel bookings that are already/));
    await userEvent.click(screen.getByRole('button', { name: /Apply to 1 area/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/blocks/bulk', expect.objectContaining({
      areaIds: ['a1'], endDate: '2030-01-20', weekdays: [6, 0], cancelBookings: true, customerName: 'Acme Corp', customerPhone: '9876543210', amount: 5000, paymentMethod: 'cash', eventKind: 'event', reason: 'Private event', kind: 'blocked', repeatWeeks: 0 })));
    expect(await screen.findByText(/1 booking\(s\) cancelled and refunded/)).toBeInTheDocument();
  });
  it('blocks the slots clicked on the grid: neighbouring slots become one block, a separate slot another', async () => {
    vi.mocked(api.post).mockClear();
    const at = (h: number) => new Date(Date.UTC(2031, 0, 5, h - 5, h === 0 ? 0 : 30)).toISOString(); // 05:30 UTC = 11:00 IST
    const slot = (h: number, over: any = {}) => ({ startsAt: at(h), endsAt: at(h + 1), price: 800, available: true, ...over });
    vi.mocked(api.get).mockImplementation((async (url: string) => (/\/slots$/.test(url) ? { slots: [slot(10), slot(11), slot(12), slot(13, { available: false, reason: 'booked' })] } : { areas: [{ id: 'a1', name: 'Turf A', venue_name: 'Green Arena', slot_minutes: 60, sport_ids: [1] }] })) as any);
    wrap();
    const grid = await screen.findByRole('list', { name: 'Time slots' });
    const btns = () => [...grid.querySelectorAll('button')];
    expect(btns()).toHaveLength(4); expect(btns()[3]).toHaveAccessibleName(/booked/);
    await userEvent.click(btns()[0]); await userEvent.click(btns()[1]); await userEvent.click(btns()[3]);
    expect(screen.getByText('3 slots chosen')).toBeInTheDocument(); expect(screen.getByText(/A chosen slot is booked/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^Reason/), 'Temporary closure');
    await userEvent.click(screen.getByRole('button', { name: /Apply to 1 area/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2)); // slots 1 and 2 are neighbours; slot 4 is on its own
    const calls = vi.mocked(api.post).mock.calls.map((c: any) => c[1]);
    expect(calls[0]).toMatchObject({ startsAt: at(10), endsAt: at(12), kind: 'maintenance', reason: 'Temporary closure' }); expect(calls[1]).toMatchObject({ startsAt: at(13), endsAt: at(14) });
  });
});
