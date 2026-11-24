import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Badge, Card, Empty, InlineModalCtx, PageHeader, QueryBoundary, Tabs } from '../../components/ui';
import { PhotoSlider } from '../../components/PhotoSlider';
import { durationLabel, titleCase } from '../../lib/utils';
import { AreaModal } from './VenueEditor';
import { AreaHoursModal } from './AreaHours';
import { ScheduleModal } from './AreaSchedule';

const TABS = [{ id: 'details', label: 'Details' }, { id: 'edit', label: 'Edit playing area' }, { id: 'hours', label: 'Opening hours' }, { id: 'slots', label: 'Slot settings' }];

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-line p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-0.5 font-semibold">{value || 'Not set'}</dd></div>;
}

/** One playing area on its own page, with JusGo's tabs: Details, Edit playing area, Opening hours, Slot settings. */
export function AreaDetailsPage() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.id === sp.get('tab')) ? sp.get('tab')! : 'details';
  const list = useQuery({ queryKey: ['owner-areas'], queryFn: () => get<{ areas: any[] }>('/owner/areas') });
  const row = list.data?.areas.find((a) => a.id === id);
  const venueQ = useQuery({ queryKey: ['owner-venue', row?.venue_id], enabled: !!row?.venue_id, queryFn: () => get<{ venue: any }>(`/owner/venues/${row!.venue_id}`) });
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  const go = (t: string) => setSp(t === 'details' ? {} : { tab: t }, { replace: true });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['owner-venue', row?.venue_id] }); qc.invalidateQueries({ queryKey: ['owner-areas'] }); };
  return (
    <QueryBoundary q={list} empty={() => !row && <Empty icon="🏟️" title="Playing area not found" action={<Link to="/owner/areas" className="btn-primary">Back to playing areas</Link>} />}>{() => row && (
      <div className="space-y-5">
        <PageHeader title={row.name} subtitle={`${row.venue_name}`} actions={<><Badge status={row.is_active ? 'active' : 'suspended'}>{row.is_active ? 'Active' : 'Inactive'}</Badge><Link to="/owner/areas" className="btn-ghost">All playing areas</Link></>} />
        <Tabs tabs={TABS} value={tab} onChange={go} />
        <QueryBoundary q={venueQ}>{({ venue }) => {
          const a = venue.areas.find((x: any) => x.id === id) ?? row;
          const photos = ((venue.images ?? []) as any[]).filter((i) => i.area_id === a.id && i.kind === 'image' && !i.delete_requested);
          const close = () => go('details');
          return (<>
            {tab === 'details' && (<div className="space-y-4">
              {photos.length > 0 && <Card className="overflow-hidden !p-0"><div className="h-56"><PhotoSlider photos={photos} alt={a.name} /></div></Card>}
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="Sports" value={(a.sport_ids ?? []).map((sid: number) => sports.data?.sports.find((s) => s.id === sid)?.name ?? sid).join(', ')} />
                <Tile label="Slot length" value={`${a.slot_minutes} min`} />
                <Tile label="Booking length" value={`${durationLabel(a.min_duration_minutes)} to ${durationLabel(a.max_duration_minutes)}`} />
                <Tile label="Capacity" value={a.capacity ? `${a.capacity} players` : ''} />
                <Tile label="Environment" value={a.environment ? titleCase(a.environment) : ''} />
                <Tile label="Roof" value={a.roof_type ? titleCase(String(a.roof_type).replace(/_/g, ' ')) : ''} />
                <Tile label="Surface" value={a.surface} />
                <Tile label="Advance booking" value={a.advance_booking_days ? `${a.advance_booking_days} days` : ''} />
              </dl>
              <div className="flex flex-wrap gap-2"><Link to="/owner/pricing" className="btn-ghost">Pricing</Link><Link to="/owner/slots" className="btn-ghost">Block time</Link></div>
            </div>)}
            <InlineModalCtx.Provider value>
            {tab === 'edit' && <AreaModal venue={venue} area={a} sports={sports.data?.sports ?? []} onClose={close} onSaved={refresh} />}
            {tab === 'hours' && <AreaHoursModal area={a} onClose={close} onSaved={refresh} />}
            {tab === 'slots' && <ScheduleModal area={a} sports={sports.data?.sports ?? []} onClose={close} onSaved={refresh} />}
            </InlineModalCtx.Provider>
          </>);
        }}</QueryBoundary>
      </div>)}</QueryBoundary>
  );
}
