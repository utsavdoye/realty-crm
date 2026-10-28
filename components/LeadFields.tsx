import { FURNISHING, POSSESSION_PREFS, WANTS, BUDGETS, FUNDING, OCCUPATIONS, PURPOSES, RAIPUR_AREAS, SCORES, SOURCES, budgetKey, fmtBudget } from '@/lib/crm';
import { ProjectPick, PropertyPick } from '@/components/LeadPick';

export type LeadRow = {
  id?: string; name?: string; phone?: string; email?: string | null; dob?: string | null; budget_min?: number | null; budget_max?: number | null;
  bhk?: string | null; property_type?: string | null; location?: string | null; purpose?: string | null; preferred_slot?: string | null;
  source?: string | null; project_id?: string | null; score?: string; assigned_to?: string | null;
  category?: string | null; city?: string | null; pincode?: string | null; occupation?: string | null; funding?: string | null; project_other?: string | null;
  segment?: string | null; want?: string | null; furnishing?: string | null; possession_pref?: string | null; size_min?: number | null; size_max?: number | null;
};

const opts = (list: string[], cur?: string | null) => [<option key="" value="">—</option>, ...list.map((x) => <option key={x} value={x}>{x}</option>)].concat(cur && !list.includes(cur) ? [<option key={cur} value={cur}>{cur}</option>] : []);

/** The budget box: fixed ranges, so filters work. An old budget that is not a range stays as it is unless changed. */
function BudgetPick({ min, max }: { min?: number | null; max?: number | null }) {
  const key = budgetKey(min, max);
  const exact = BUDGETS.some((b) => b.k === key && (b.min ?? null) === (min ?? null) && (b.max ?? null) === (max ?? null));
  const keep = (min != null || max != null) && !exact;
  return (
    <label className="field"><span className="label">Budget</span>
      <select name="budget" defaultValue={keep ? 'keep' : key}>
        <option value="">Not sure / not told</option>
        {keep && <option value="keep">{fmtBudget(min, max)} (as saved)</option>}
        {BUDGETS.map((b) => <option key={b.k} value={b.k}>{b.l}</option>)}
      </select>
    </label>
  );
}

/** All lead fields, in the order the team agreed. Used on Add lead and Edit lead. */
export function LeadFields({ lead = {}, projects, people, showAssign, showNote }: {
  lead?: LeadRow; projects: { id: string; name: string }[]; people?: { user_id: string; full_name: string }[]; showAssign?: boolean; showNote?: boolean;
}) {
  const isNew = !lead.id;
  return (
    <div className="grid2f">
      {lead.id && <input type="hidden" name="id" value={lead.id} />}
      <label className="field"><span className="label">Client name *</span><input name="name" required defaultValue={lead.name ?? ''} /></label>
      <label className="field"><span className="label">Mobile *</span><input name="phone" required inputMode="tel" defaultValue={lead.phone ?? ''} placeholder="98765 43210 or +971 50 123 4567" title="India: 10 digits. Other countries: + and country code" /></label>

      <label className="field"><span className="label">Client wants to</span><select name="want" defaultValue={lead.want ?? 'Buy'}>{opts(WANTS, lead.want)}</select></label>
      <PropertyPick category={lead.category} bhk={lead.bhk} ptype={lead.property_type} />
      <BudgetPick min={lead.budget_min} max={lead.budget_max} />

      <label className="field"><span className="label">Area they want</span>
        <input name="location" list="raipur-areas" defaultValue={lead.location ?? ''} placeholder="e.g. Shankar Nagar, or Naya Raipur – Sector 15" maxLength={200} />
      </label>
      <datalist id="raipur-areas">{RAIPUR_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
      <label className="field"><span className="label">Purpose of buying</span><select name="purpose" defaultValue={lead.purpose ?? ''}>{opts(PURPOSES, lead.purpose)}</select></label>
      <label className="field"><span className="label">Funding</span><select name="funding" defaultValue={lead.funding ?? ''}>{opts(FUNDING, lead.funding)}</select></label>
      <label className="field"><span className="label">Possession wanted</span><select name="possession_pref" defaultValue={lead.possession_pref ?? ''}>{opts(POSSESSION_PREFS, lead.possession_pref)}</select></label>
      <label className="field"><span className="label">Furnishing</span><select name="furnishing" defaultValue={lead.furnishing ?? ''}>{opts(FURNISHING, lead.furnishing)}</select></label>
      <label className="field"><span className="label">Size wanted (sq ft)</span>
        <span className="row-gap"><input name="size_min" type="number" min={0} step={50} defaultValue={lead.size_min ?? ''} placeholder="From" aria-label="Size from" /><input name="size_max" type="number" min={0} step={50} defaultValue={lead.size_max ?? ''} placeholder="To" aria-label="Size to" /></span>
      </label>

      <ProjectPick projects={projects} projectId={lead.project_id} other={lead.project_other} />
      <label className="field"><span className="label">Source</span><select name="source" defaultValue={lead.source ?? ''}>{opts(SOURCES, lead.source)}</select></label>
      {isNew && (
        <label className="field"><span className="label">Interest</span>
          <select name="score" defaultValue={lead.score ?? 'warm'}>{SCORES.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
        </label>
      )}
      {showAssign && people && (
        <label className="field"><span className="label">Assign to</span>
          <select name="assigned_to" defaultValue={lead.assigned_to ?? ''}><option value="">Automatic (next in turn)</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select>
        </label>
      )}
      <label className="field"><span className="label">Best time for a call / Google Meet</span><input name="preferred_slot" defaultValue={lead.preferred_slot ?? ''} placeholder="e.g. Weekdays after 6 PM" /></label>

      <details className="field full more-fields" open={Boolean(lead.email || lead.dob || lead.city || lead.pincode || lead.occupation)}>
        <summary className="linkbtn small">More details (optional): email, city, pincode, job, birthday</summary>
        <div className="grid2f">
          <label className="field"><span className="label">Email</span><input name="email" type="email" defaultValue={lead.email ?? ''} /></label>
          <label className="field"><span className="label">Occupation</span><select name="occupation" defaultValue={lead.occupation ?? ''}>{opts(OCCUPATIONS, lead.occupation)}</select></label>
          <label className="field"><span className="label">Client&apos;s city</span><input name="city" defaultValue={lead.city ?? ''} placeholder="e.g. Raipur" maxLength={80} /></label>
          <label className="field"><span className="label">Pincode</span><input name="pincode" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} defaultValue={lead.pincode ?? ''} placeholder="e.g. 492001" title="6 digits" /></label>
          <label className="field"><span className="label">Date of birth</span><input name="dob" type="date" defaultValue={lead.dob ?? ''} /></label>
          <label className="field"><span className="label">Lead type</span>
            <select name="segment" defaultValue={lead.segment ?? 'primary'}><option value="primary">Primary (new project)</option><option value="secondary">Secondary (resale)</option></select>
          </label>
        </div>
      </details>
      {showNote && <label className="field full"><span className="label">Remarks (optional)</span><textarea name="note" rows={2} maxLength={300} placeholder="e.g. Will buy after 6 months, waiting for loan approval" /></label>}
    </div>
  );
}
