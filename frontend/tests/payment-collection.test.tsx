import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { PaymentCollection } from '../src/pages/owner/OwnerAccount';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), put: vi.fn() }));

describe('How customers pay when they book', () => {
  it('advance asks for a percentage, warns what customers pay, and saves it', async () => {
    vi.mocked(api.get).mockResolvedValue({ mode: 'full', advancePercent: null } as any);
    vi.mocked(api.put).mockResolvedValue({} as any);
    render(<QueryClientProvider client={new QueryClient()}><ToastProvider><MemoryRouter><PaymentCollection /></MemoryRouter></ToastProvider></QueryClientProvider>);
    expect(await screen.findByRole('radio', { name: /Full amount/ })).toBeChecked();
    expect(screen.queryByText(/You have chosen advance payment/)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /Advance amount only/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the advance percentage, from 1 to 99.')).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Advance percentage/), '30');
    expect(screen.getByText(/You have chosen advance payment/).parentElement).toHaveTextContent('they pay only 30% of the amount you set for the slot (for a ₹1,000 slot, ₹300 when booking). They pay the rest after they finish playing.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/payment-collection', { mode: 'advance', advancePercent: 30 }));
  });
});
