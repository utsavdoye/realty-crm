import { saveDeal } from '@/app/money-actions';
import { ActionForm, Submit } from '@/components/forms';

type D = { id?: string; lead_id?: string | null; project_id?: string | null; buyer_name?: string; unit_no?: string | null; booked_on?: string; agreement_value?: number | null; commission_pct?: number | null; commission_amount?: number | null; agent_id?: string | null; incentive_amount?: number | null; status?: string; notes?: string | null };

export function DealForm({ d, projects, people, isNew }: { d: D; projects: { id: string; name: string }[]; people: { user_id: string; full_name: string }[]; isNew?: boolean }) {
  return (
    <ActionForm action={saveDeal} className="stack">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      {d.lead_id && <input type="hidden" name="lead_id" value={d.lead_id} />}
      <div className="grid2f">
        <label className="field"><span className="label">Buyer name *</span><input name="buyer_name" required defaultValue={d.buyer_name ?? ''} /></label>
        <label className="field"><span className="label">Booked on</span><input type="date" name="booked_on" defaultValue={d.booked_on ?? ''} /></label>
        <label className="field"><span className="label">Project</span><select name="project_id" defaultValue={d.project_id ?? ''}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span className="label">Unit / flat no.</span><input name="unit_no" defaultValue={d.unit_no ?? ''} placeholder="e.g. B-1204" /></label>
        <label className="field"><span className="label">Deal value (₹) *</span><input name="agreement_value" required defaultValue={d.agreement_value ? String(d.agreement_value) : ''} placeholder="e.g. 1.25 Cr" /></label>
        <label className="field"><span className="label">Commission %</span><input name="commission_pct" type="number" step="0.01" min="0" max="100" defaultValue={d.commission_pct ?? 2} /></label>
        <label className="field"><span className="label">Commission (₹) — leave empty to use %</span><input name="commission_amount" defaultValue={!isNew && d.commission_amount ? String(d.commission_amount) : ''} /></label>
        <label className="field"><span className="label">Employee who closed it</span><select name="agent_id" defaultValue={d.agent_id ?? ''}><option value="">—</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></label>
        <label className="field"><span className="label">Their incentive (₹)</span><input name="incentive_amount" defaultValue={d.incentive_amount ? String(d.incentive_amount) : ''} placeholder="e.g. 25000" /></label>
        {!isNew && <label className="field"><span className="label">Status</span><select name="status" defaultValue={d.status ?? 'active'}><option value="active">Active</option><option value="cancelled">Cancelled</option></select></label>}
        <label className="field full"><span className="label">Notes</span><input name="notes" defaultValue={d.notes ?? ''} placeholder="e.g. Builder pays commission in 2 parts" /></label>
        {isNew && <label className="check full"><input type="checkbox" name="plan" value="none" /> Do not add the usual payment plan (2% token, 8% agreement, 80% loan, 10% possession)</label>}
      </div>
      <div><Submit>{isNew ? 'Save deal' : 'Save changes'}</Submit></div>
    </ActionForm>
  );
}
