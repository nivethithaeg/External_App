import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Badge, Empty, PageHeader, QueryBoundary, Select, Stat, Table } from '../../components/ui';
import { fmtDate, fmtDateTime, money } from '../../lib/utils';

type Row = { id: string; reference: string; venue_name: string; area_name: string; customer_name: string | null; starts_at: string; release_at: string | null; state: 'hold' | 'ready' | 'dispute';
  gross: number; fee: number; on_hold: number; ready_to_pay: number; dispute: number; refunded: number; complaint_refund?: number };
type Data = { holdHours: number; totals: { gross: number; fee: number; on_hold: number; ready_to_pay: number; dispute: number }; bookings: Row[] };
const STATE: Record<Row['state'], { label: string; badge: string }> = { hold: { label: 'On hold', badge: 'pending' }, ready: { label: 'Ready to pay', badge: 'approved' }, dispute: { label: 'Dispute', badge: 'rejected' } };
const dash = <span className="text-muted">—</span>;

/** Where the money of each PlaynX booking stands: gross value, on hold, ready to pay, or held in a dispute. */
export function OwnerPayoutsPage() {
  const q = useQuery({ queryKey: ['owner-payout-status'], queryFn: () => get<Data>('/owner/payout-status') });
  const [show, setShow] = useState<'' | Row['state']>('');
  return (
    <div><PageHeader title="Payouts" subtitle="What customers paid for PlaynX bookings, and when your share reaches you." />
      <QueryBoundary q={q} empty={(d) => d.bookings.length === 0 && <Empty icon="🏦" title="No PlaynX bookings yet" hint="Bookings customers pay for on PlaynX appear here with their payout status." />}>{(d) => {
        const rows = d.bookings.filter((b) => !show || b.state === show);
        return (<div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Gross value" value={money(d.totals.gross)} />
            <Stat label="On hold" value={money(d.totals.on_hold)} />
            <Stat label="Ready to pay" value={money(d.totals.ready_to_pay)} accent />
            <Stat label="Dispute" value={money(d.totals.dispute)} />
          </div>
          <ul className="grid gap-2 rounded-2xl border border-line p-4 text-sm text-muted sm:grid-cols-2">
            <li><b className="text-ink">Gross value:</b> what the customer pays for the booking.</li>
            <li><b className="text-ink">On hold:</b> your share, kept by PlaynX for {d.holdHours} hours after the game ends.</li>
            <li><b className="text-ink">Ready to pay:</b> after the hold, with no complaint: the gross value less that booking's platform fee comes to you. Each booking has its own fee, shown under its gross value.</li>
            <li><b className="text-ink">Dispute:</b> the customer raised a complaint. PlaynX holds the full amount until it is settled. Once settled, the amount refunded to the customer stays here; the rest of your share moves on to On hold or Ready to pay.</li>
          </ul>
          <div className="max-w-xs"><Select label="Show" value={show} onChange={(e) => setShow(e.target.value as any)}><option value="">All bookings</option><option value="hold">On hold</option><option value="ready">Ready to pay</option><option value="dispute">Dispute</option></Select></div>
          {rows.length === 0 ? <Empty icon="🏦" title="Nothing here" hint="Try another filter." /> : (
            <Table rows={rows} columns={[
              { key: 'reference', header: 'Booking ID', render: (b: Row) => <div><b>{b.reference}</b><div className="text-xs text-muted">{b.venue_name} · {b.area_name}</div><div className="text-xs text-muted">{fmtDate(b.starts_at)}</div></div> },
              { key: 'gross', header: 'Gross value', render: (b: Row) => <div><b>{money(b.gross)}</b><div className="text-xs text-muted">Platform fee {money(b.fee)}</div></div> },
              { key: 'on_hold', header: 'On hold', render: (b: Row) => (b.on_hold ? <div>{money(b.on_hold)}{b.release_at && <div className="text-xs text-muted">Until {fmtDateTime(b.release_at)}</div>}</div> : dash) },
              { key: 'ready', header: 'Ready to pay', render: (b: Row) => (b.ready_to_pay ? <b className="text-ok">{money(b.ready_to_pay)}</b> : dash) },
              { key: 'dispute', header: 'Dispute', render: (b: Row) => (b.dispute ? <div><b className="text-danger">{money(b.dispute)}</b><div className="text-xs text-muted">{b.state === 'dispute' ? 'Held: the customer complained' : 'Refunded to the customer after a complaint'}</div></div> : dash) },
              { key: 'state', header: 'Status', render: (b: Row) => <Badge status={STATE[b.state].badge}>{STATE[b.state].label}</Badge> },
            ]} />)}
        </div>);
      }}</QueryBoundary>
    </div>);
}
