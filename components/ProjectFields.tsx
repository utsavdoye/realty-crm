import { PROJECT_DEALS, PROJECT_STATUS, PROJECT_TYPES } from '@/lib/crm';
import { LocationPicker } from '@/components/LocationPicker';

export type ProjectRow = {
  id: string; name: string; developer: string | null; location: string | null; rera_no: string | null; type: string | null; configs: string | null;
  price_from: number | null; price_to: number | null; status: string | null; possession: string | null; highlights: string | null; link: string | null;
  photos: string[] | null; lat: number | null; lng: number | null; is_public: boolean; share_token: string;
  floor_plans: { url: string; label: string }[] | null; size_from: number | null; size_to: number | null; towers: string | null; units: number | null;
  amenities: string | null; banks: string | null;
  map_url?: string | null; on_website?: boolean | null; deal?: string | null; payment_plan?: string | null; terms?: string | null; rate_card?: { floors: string; rate: number }[] | null;
};

/** All the project boxes, used by "Add a project" and "Edit". */
export function ProjectFields({ p }: { p?: ProjectRow }) {
  const v = (k: keyof ProjectRow) => (p?.[k] ?? '') as string;
  return (
    <div className="grid2f">
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className="field"><span className="label">Project name *</span><input name="name" required defaultValue={v('name')} /></label>
      <label className="field"><span className="label">Developer</span><input name="developer" defaultValue={v('developer')} /></label>
      <label className="field"><span className="label">Location</span><input name="location" defaultValue={v('location')} placeholder="e.g. VIP Road, Raipur" /></label>
      <label className="field"><span className="label">RERA number</span><input name="rera_no" defaultValue={v('rera_no')} /></label>
      <label className="field"><span className="label">Type</span><select name="type" defaultValue={v('type')}><option value="">—</option>{PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="field"><span className="label">Sale or lease</span><select name="deal" defaultValue={p?.deal ?? 'sale'}>{PROJECT_DEALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field"><span className="label">Unit options</span><input name="configs" defaultValue={v('configs')} placeholder="e.g. 2, 3 BHK" /></label>
      <label className="field"><span className="label">Price from (₹ lakh)</span><input name="price_from" type="number" min="0" step="0.1" defaultValue={v('price_from')} /></label>
      <label className="field"><span className="label">Price up to (₹ lakh)</span><input name="price_to" type="number" min="0" step="0.1" defaultValue={v('price_to')} /></label>
      <label className="field"><span className="label">Size from (sq ft)</span><input name="size_from" type="number" min="0" step="1" defaultValue={v('size_from')} placeholder="e.g. 950" /></label>
      <label className="field"><span className="label">Size up to (sq ft)</span><input name="size_to" type="number" min="0" step="1" defaultValue={v('size_to')} placeholder="e.g. 1650" /></label>
      <label className="field"><span className="label">Status</span><select name="status" defaultValue={v('status')}><option value="">—</option>{PROJECT_STATUS.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="field"><span className="label">Possession</span><input name="possession" defaultValue={v('possession')} placeholder="e.g. Dec 2027" /></label>
      <label className="field"><span className="label">Towers and floors</span><input name="towers" defaultValue={v('towers')} placeholder="e.g. 4 towers, G+14" /></label>
      <label className="field"><span className="label">Total homes</span><input name="units" type="number" min="0" step="1" defaultValue={v('units')} placeholder="e.g. 320" /></label>
      <label className="field full"><span className="label">Highlights</span><input name="highlights" defaultValue={v('highlights')} placeholder="Corner plot, 5 min from Magneto Mall" /></label>
      <label className="field full"><span className="label">Amenities</span><input name="amenities" defaultValue={v('amenities')} placeholder="Pool, gym, clubhouse, kids play area, 24×7 security, power backup" /></label>
      <label className="field full"><span className="label">Home loan from</span><input name="banks" defaultValue={v('banks')} placeholder="SBI, HDFC, ICICI" /></label>
      <label className="field full"><span className="label">Payment plan</span><textarea name="payment_plan" rows={3} defaultValue={v('payment_plan')} placeholder="e.g. 10% booking, then 10% at each slab… or Down payment 20%, loan 80%" /></label>
      <label className="field full"><span className="label">Booking terms (for the team)</span><textarea name="terms" rows={3} defaultValue={v('terms')} placeholder="GST, registry, maintenance, cancellation charges…" /></label>
      <label className="field full"><span className="label">Google Maps link</span><input name="map_url" defaultValue={v('map_url')} placeholder="https://maps.app.goo.gl/…" /></label>
      <label className="field full"><span className="label">Brochure or website link</span><input name="link" defaultValue={v('link')} placeholder="Or upload a PDF below" /></label>
      <LocationPicker lat={p?.lat} lng={p?.lng} area={p?.location} />
    </div>
  );
}
