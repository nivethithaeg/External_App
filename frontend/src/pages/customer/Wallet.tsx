import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Card, Empty, PageHeader, QueryBoundary } from '../../components/ui';
import { fmtDate, fmtDateTime, money } from '../../lib/utils';

const KIND: Record<string, string> = { refund: 'Refund kept as credit', admin_credit: 'Credit from KickOff', admin_debit: 'Adjustment by KickOff', booking_payment: 'Paid for a booking', booking_release: 'Returned: booking not completed' };

/** The customer's wallet: what they can spend, what is about to expire, and every movement. It is credit only: it cannot be withdrawn as cash. */
export function WalletPage() {
  const q = useQuery({ queryKey: ['wallet', 'page'], queryFn: () => get<{ balance: number; expiryMonths: number; expiringSoon: { amount: number; at: string } | null; entries: { id: number; delta: number; kind: string; note: string | null; created_at: string; reference: string | null }[] }>('/me/wallet') });
  return (
    <div className="mx-auto max-w-2xl space-y-5"><PageHeader title="My wallet" subtitle="Credit you can use on your next booking" />
      <QueryBoundary q={q}>{(d) => (<>
        <Card className="space-y-2 p-6"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Available balance</p>
          <p className="font-display text-6xl font-extrabold text-[rgb(var(--brand-text))]">{money(d.balance)}</p>
          {d.expiringSoon && <p role="status" className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">{money(d.expiringSoon.amount)} expires on {fmtDate(d.expiringSoon.at)}. Use it before then.</p>}
          <p className="text-xs text-muted">Wallet credit comes from refunds you chose to keep, money returned when a booking was not completed, and credits from KickOff. It cannot be withdrawn as cash and each credit expires {d.expiryMonths} months after it is added. Choose <b>Use my wallet balance</b> when you book. <Link className="underline" to="/venues">Find a turf</Link></p></Card>
        {d.entries.length === 0 ? <Empty icon="👛" title="No wallet activity yet" hint="When you keep a refund as credit, or KickOff adds a credit, it appears here." /> : (
          <Card className="divide-y divide-line"><h2 className="p-4 text-2xl font-bold">History</h2>
            <ul>{d.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 p-4 text-sm"><span><b>{KIND[e.kind] ?? e.kind}</b>{e.reference && <span className="text-muted"> · {e.reference}</span>}<span className="block text-xs text-muted">{e.note ? `${e.note} · ` : ''}{fmtDateTime(e.created_at)}</span></span>
                <b className={e.delta > 0 ? 'text-ok' : 'text-ink'}>{e.delta > 0 ? '+' : '−'}{money(Math.abs(e.delta))}</b></li>))}</ul></Card>)}
      </>)}</QueryBoundary>
    </div>
  );
}
