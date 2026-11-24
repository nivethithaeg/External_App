import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table } from '../src/components/ui';

type Row = { id: string; ref: string; status: string; total: number };
const cols = [{ key: 'ref', header: 'Ref' }, { key: 'status', header: 'Status' }, { key: 'total', header: 'Total' }];
const rows = (over: Partial<Row> = {}): Row[] => [{ id: 'a', ref: 'KO-1', status: 'confirmed', total: 800 }, { id: 'b', ref: 'KO-2', status: 'pending', total: 400, ...over }];

describe('animated booking table', () => {
  it('keeps every column and row, and rows can still be clicked for details', async () => {
    const seen: string[] = [];
    render(<Table animated rows={rows()} columns={cols} onRow={(r) => seen.push(r.ref)} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Ref', 'Status', 'Total']);
    await userEvent.click(screen.getByText('KO-2'));
    expect(seen).toEqual(['KO-2']);
  });

  it('selects several rows with checkboxes without opening them, and clears the selection', async () => {
    const seen: string[] = [];
    render(<Table animated rows={rows()} columns={cols} onRow={(r) => seen.push(r.ref)} />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Select this row' });
    await userEvent.click(boxes[0]); await userEvent.click(boxes[1]);
    expect(seen).toEqual([]); // ticking a row does not open it
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    expect(screen.getAllByRole('row').filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());
  });

  it('flashes only the cell whose value changed after a refresh, never on the first load', () => {
    const { rerender, container } = render(<Table animated rows={rows()} columns={cols} />);
    expect(container.querySelectorAll('.cell-flash')).toHaveLength(0);
    rerender(<Table animated rows={rows({ status: 'confirmed' })} columns={cols} />);
    const flashed = [...container.querySelectorAll('.cell-flash')];
    expect(flashed).toHaveLength(1); expect(flashed[0]).toHaveTextContent('confirmed'); // just that cell, not the row
  });

  it('forgets a selected row that has left the table', async () => {
    const { rerender } = render(<Table animated rows={rows()} columns={cols} />);
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Select this row' })[1]);
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    rerender(<Table animated rows={rows().slice(0, 1)} columns={cols} />);
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });
});
