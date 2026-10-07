import { requireOrg } from '@/lib/context';
import { MapView, type MapProjectFull } from '@/components/MapView';
import { areaPoint } from '@/lib/places';

export const metadata = { title: 'Map' };

export default async function MapPage() {
  const { supabase, org } = await requireOrg(['owner', 'manager', 'agent']);
  const [{ data: projects }, { data: leads }] = await Promise.all([
    supabase.from('projects').select('id, name, lat, lng, status, type, location, configs, price_from, price_to, photos').eq('org_id', org.id).order('name'),
    supabase.from('leads').select('location, project_id').eq('org_id', org.id).not('stage', 'in', '(booked,lost)').limit(10000),
  ]);
  const per = new Map<string, number>();
  const demandMap = new Map<string, { area: string; lat: number; lng: number; n: number }>();
  (leads ?? []).forEach((l) => {
    if (l.project_id) per.set(l.project_id, (per.get(l.project_id) ?? 0) + 1);
    const pt = areaPoint(l.location);
    if (pt) {
      const k = pt.join(',');
      const d = demandMap.get(k) ?? { area: (l.location ?? '').split(',')[0].trim().slice(0, 40), lat: pt[0], lng: pt[1], n: 0 };
      d.n++; demandMap.set(k, d);
    }
  });
  const all = projects ?? [];
  const onMap: MapProjectFull[] = all.filter((p) => p.lat != null && p.lng != null).map((p) => ({
    id: p.id, name: p.name, lat: p.lat!, lng: p.lng!, status: p.status, type: p.type, location: p.location, configs: p.configs,
    price_from: p.price_from, price_to: p.price_to, photo: (p.photos as string[] | null)?.[0] ?? null, leads: per.get(p.id) ?? 0,
  }));
  return (
    <>
      <div className="top"><div className="top-title"><h1>Map</h1><p className="hint">Your projects in 3D, and where your leads want to buy. Distances are straight-line, so they are approximate.</p></div></div>
      <MapView projects={onMap} demand={[...demandMap.values()]} missing={all.filter((p) => p.lat == null).map((p) => p.name)} />
    </>
  );
}
