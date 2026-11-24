import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../src/lib/api';
import { OwnerPayoutsPage } from '../src/pages/owner/OwnerPayouts';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn() }));
const row = (o: any) => ({ id: o.ref, reference: o.ref, venue_name: 'Green Arena', area_name: 'Turf A', customer_name: 'Ravi', starts_at: '2030-01-01T10:00:00Z', release_at: '2030-01-03T11:00:00Z', gross: 1000, fee: 100, on_hold: 0, ready_to_pay: 0, dispute: 0, refunded: 0, ...o });

describe('Payouts page', () => {
  it('shows gross value, on hold, ready to pay and dispute, as totals and per booking', async () => {
    vi.mocked(api.get).mockResolvedValue({ holdHours: 48, totals: { gross: 3000, fee: 300, on_hold: 900, ready_to_pay: 900, dispute: 1000 },
      bookings: [row({ ref: 'KO-HOLD', state: 'hold', on_hold: 900 }), row({ ref: 'KO-READY', state: 'ready', ready_to_pay: 900 }), row({ ref: 'KO-DISP', state: 'dispute', dispute: 1000, refunded: 400 })] } as any);
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OwnerPayoutsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument();
    for (const h of ['Gross value', 'On hold', 'Ready to pay', 'Dispute']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('KO-DISP').closest('tr')!).toHaveTextContent('Held: the customer complained');
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'ready');
    expect(screen.queryByText('KO-HOLD')).toBeNull(); expect(within(screen.getByText('KO-READY').closest('tr')!).getByText('₹900')).toBeInTheDocument();
  });
});
