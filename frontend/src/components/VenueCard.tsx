import { useAutoSlide } from './PhotoSlider';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Burst, CountUp, useTilt } from './Motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { del, put, apiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { money } from '../lib/utils';
import { Stars } from './ui';
import { useNavigate } from 'react-router-dom';

export interface VenueSummary {
  id: string; name: string; city: string; address: string; rating_avg: number; rating_count: number; min_price: number | null;
  distance_km?: number | null; cover_image: string | null; photos?: string[]; discount_percent?: number; sports?: string[]; is_favourite?: boolean;
  facilities?: string[]; category?: string | null; lat?: number | string | null; lng?: number | string | null; popularity?: number;
}

export function VenueCover({ src, name, className = '' }: { src: string | null; name: string; className?: string }) {
  return src ? <img src={src} alt={name} loading="lazy" className={`h-full w-full object-cover ${className}`} /> : (
    <div className="pitch-stripes grid h-full w-full place-items-center bg-gradient-to-br from-[#1B2A80] to-[#101B5C] text-4xl" aria-hidden="true">⚽</div>
  );
}

export function FavouriteButton({ venueId, active }: { venueId: string; active: boolean }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [burst, setBurst] = useState(0);
  const m = useMutation({
    mutationFn: () => (active ? del(`/me/favourites/${venueId}`) : put(`/me/favourites/${venueId}`)),
    onSuccess: () => { if (!active) setBurst((n) => n + 1); qc.invalidateQueries({ queryKey: ['venues'] }); qc.invalidateQueries({ queryKey: ['venue', venueId] }); qc.invalidateQueries({ queryKey: ['favourites'] }); toast(active ? 'Removed from favourites' : 'Saved to favourites'); },
    onError: (e) => toast(apiError(e), 'error'),
  });
  return (
    <button type="button" aria-pressed={active} aria-label={active ? 'Remove from favourites' : 'Add to favourites'} disabled={m.isPending}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!user) return nav('/login'); if (user.role !== 'customer') return toast('Only customers can save favourites', 'info'); m.mutate(); }}
      className="relative grid h-9 w-9 place-items-center rounded-full bg-black/55 text-lg backdrop-blur transition hover:scale-110 active:scale-90"><span key={String(active)} className={active ? 'animate-pop' : ''}>{active ? '❤️' : '🤍'}</span><Burst fire={burst} glyphs={['♥']} colors={['#FF4D6D', '#7200FF', '#FFB3C1']} count={9} /></button>
  );
}

export function VenueCard({ v }: { v: VenueSummary }) {
  const tilt = useTilt(5);
  const photos = (v.photos && v.photos.length > 1 ? v.photos : null);
  const [pi, setPi] = useState(0); const [hov, setHov] = useState(false);
  useAutoSlide(photos?.length ?? 0, pi, setPi, { ms: 3500, paused: hov }); // the photos slide by themselves; they wait while the pointer is on the card
  return (
    <Link ref={tilt.ref as any} {...tilt.handlers} onPointerEnter={() => setHov(true)} onPointerLeave={(e) => { setHov(false); tilt.handlers.onPointerLeave(); }} to={`/venues/${v.id}`} className={`card spot group animate-rise block overflow-hidden transition-[transform,border-color,box-shadow] duration-200 active:scale-[.985] ${tilt.on ? 'will-change-transform' : 'hover:-translate-y-1'} hover:border-brand/50`}>
      <div className="relative h-44 overflow-hidden">
        <div className="h-full w-full transition-transform duration-300 ease-out" style={{ transform: 'translate(var(--shift-x, 0px), var(--shift-y, 0px)) scale(1.06)' }}>
          {photos ? photos.map((u, i) => <img key={u} src={u} alt={i === 0 ? v.name : ''} loading="lazy" className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${i === pi ? 'opacity-100' : 'opacity-0'}`} />) : <VenueCover src={v.cover_image} name={v.name} className="transition duration-500 group-hover:scale-105" />}</div>
        {photos && <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden="true">{photos.map((_, i) => <i key={i} className={`h-1.5 rounded-full transition-all ${i === pi ? 'w-4 bg-brand' : 'w-1.5 bg-white/60'}`} />)}</div>}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/85 to-black/40 py-2.5 text-center text-sm font-bold text-white transition-transform duration-300 [@media(hover:hover)]:group-hover:translate-y-0">Book now →</span>
        <div className="absolute right-3 top-3"><FavouriteButton venueId={v.id} active={!!v.is_favourite} /></div>
        {(v.discount_percent ?? 0) > 0 && <span className="absolute left-3 top-3 rounded-full bg-brand px-2.5 py-1 text-xs font-extrabold tracking-wide text-brand-ink shadow">{v.discount_percent}% OFF</span>}
        {v.distance_km != null && <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">{v.distance_km} km away</span>}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2"><h3 className="text-2xl font-bold leading-tight">{v.name}</h3>
          <div className="text-right"><div className="text-xs text-muted">from{(v.discount_percent ?? 0) > 0 && v.min_price != null && <s className="ml-1.5 text-muted/80">{money(v.min_price)}</s>}</div><div className="font-display text-xl font-bold text-[rgb(var(--brand-text))]">{v.min_price != null ? <><CountUp value={Math.round(v.min_price * (100 - (v.discount_percent ?? 0))) / 100} format={(n) => money(Math.round(n))} />/hr</> : '—'}</div></div></div>
        <p className="line-clamp-1 text-sm text-muted">{v.address}, {v.city}</p>
        <div className="flex items-center gap-2 text-xs text-muted">{v.rating_count > 0 ? <><Stars value={Number(v.rating_avg)} size={14} /><span>{Number(v.rating_avg).toFixed(1)} ({v.rating_count})</span></> : <span className="chip">New</span>}</div>
        {v.sports && v.sports.length > 0 && <div className="flex flex-wrap gap-1.5">{v.sports.slice(0, 5).map((s, i) => <span key={s} className="chip transition duration-300 [@media(hover:hover)]:group-hover:-translate-y-0.5 [@media(hover:hover)]:group-hover:border-brand/50" style={{ transitionDelay: `${i * 45}ms` }}>{s}</span>)}{v.sports.length > 5 && <span className="chip" title={v.sports.slice(5).join(', ')}>+{v.sports.length - 5} more</span>}</div>}
        {v.facilities && v.facilities.length > 0 && <p className="line-clamp-1 text-xs text-muted transition duration-300 [@media(hover:hover)]:group-hover:translate-x-1 [@media(hover:hover)]:group-hover:text-ink">{v.facilities.slice(0, 4).join(' · ')}</p>}
        <div className="flex items-center justify-between gap-2 pt-1"><span className="inline-flex items-center gap-1 text-xs font-semibold text-ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity=".35" /><path className="draw-tick" d="M7 12.5l3.2 3.2L17 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg> PlaynX verified</span><span className="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-brand-ink transition duration-200 group-hover:scale-105 group-hover:shadow-[0_0_16px_rgb(var(--brand)/.45)]">Book Now</span></div>
      </div>
    </Link>
  );
}
