import { BHKS, PTYPES, PURPOSES, SOURCES, fmtBudget } from '@/lib/crm';

export type LeadRow = {
  id?: string; name?: string; phone?: string; email?: string | null; dob?: string | null; budget_min?: number | null; budget_max?: number | null;
  bhk?: string | null; property_type?: string | null; location?: string | null; purpose?: string | null; preferred_slot?: string | null;
  source?: string | null; project_id?: string | null; score?: string; assigned_to?: string | null;
};

const opts = (list: string[], cur?: string | null) => [<option key="" value="">—</option>, ...list.map((x) => <option key={x} value={x}>{x}</option>)].concat(cur && !list.includes(cur) ? [<option key={cur} value={cur}>{cur}</option>] : []);

/** All lead fields. Used on Add lead and Edit lead. */
export function LeadFields({ lead = {}, projects, people, showAssign, showNote }: {
  lead?: LeadRow; projects: { id: string; name: string }[]; people?: { user_id: string; full_name: string }[]; showAssign?: boolean; showNote?: boolean;
}) {
  return (
    <div className="grid2f">
      {lead.id && <input type="hidden" name="id" value={lead.id} />}
      <label className="field"><span className="label">Client name *</span><input name="name" required defaultValue={lead.name ?? ''} /></label>
      <label className="field"><span className="label">Mobile *</span><input name="phone" required inputMode="tel" defaultValue={lead.phone ?? ''} placeholder="98765 43210 or +971 50 123 4567" title="India: 10 digits. Other countries: + and country code" /></label>
      <label className="field"><span className="label">Email</span><input name="email" type="email" defaultValue={lead.email ?? ''} /></label>
      <label className="field"><span className="label">Date of birth</span><input name="dob" type="date" defaultValue={lead.dob ?? ''} /></label>
      <label className="field"><span className="label">Budget</span><input name="budget" defaultValue={fmtBudget(lead.budget_min, lead.budget_max).replace('Up to ', '')} placeholder="e.g. 60 L to 80 L, or 1.2 Cr" /></label>
      <label className="field"><span className="label">Looking for</span><select name="bhk" defaultValue={lead.bhk ?? ''}>{opts(BHKS, lead.bhk)}</select></label>
      <label className="field"><span className="label">Property type</span><select name="property_type" defaultValue={lead.property_type ?? ''}>{opts(PTYPES, lead.property_type)}</select></label>
      <label className="field"><span className="label">Preferred location</span><input name="location" defaultValue={lead.location ?? ''} placeholder="e.g. Whitefield" /></label>
      <label className="field"><span className="label">Purpose of buying</span><select name="purpose" defaultValue={lead.purpose ?? ''}>{opts(PURPOSES, lead.purpose)}</select></label>
      <label className="field"><span className="label">Best time for a call / Google Meet</span><input name="preferred_slot" defaultValue={lead.preferred_slot ?? ''} placeholder="e.g. Weekdays after 6 PM" /></label>
      <label className="field"><span className="label">Source</span><select name="source" defaultValue={lead.source ?? ''}>{opts(SOURCES, lead.source)}</select></label>
      <label className="field"><span className="label">Project</span>
        <select name="project_id" defaultValue={lead.project_id ?? ''}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <label className="field"><span className="label">Interest</span>
        <select name="score" defaultValue={lead.score ?? 'warm'}><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
      </label>
      {showAssign && people && (
        <label className="field"><span className="label">Assign to</span>
          <select name="assigned_to" defaultValue={lead.assigned_to ?? ''}><option value="">Automatic (fewest open leads)</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select>
        </label>
      )}
      {showNote && <label className="field full"><span className="label">First note</span><textarea name="note" rows={2} placeholder="What did they ask about?" /></label>}
    </div>
  );
}
