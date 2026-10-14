import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { SCORES, SOURCES, STATUS_LIST, istDay } from '@/lib/crm';

export const metadata = { title: 'Export to Excel' };

/** Pick what to download: a month, a date range, a project, a source, a person, a status. */
export default async function ExportPage() {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const [{ data: projects }, { data: people }] = await Promise.all([
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id).neq('role', 'partner').order('full_name'),
  ]);
  const thisMonth = istDay(new Date()).slice(0, 7);
  return (
    <>
      <div className="top"><div className="top-title"><h1>Export to Excel</h1><p className="hint">One file with two sheets: Leads (every detail) and History (every call, note and visit).</p></div><Link className="btn ghost" href="/leads">Back to leads</Link></div>
      <section className="panel narrow">
        <div className="panel-b" style={{ paddingTop: 16 }}>
          <form action="/api/export" method="get" className="stack">
            <div className="grid2f">
              <label className="field"><span className="label">Month</span><input type="month" name="month" defaultValue={thisMonth} /></label>
              <p className="hint" style={{ alignSelf: 'end' }}>Leave the month empty to use the dates below, or leave all empty for everything.</p>
              <label className="field"><span className="label">Came in from</span><input type="date" name="from" /></label>
              <label className="field"><span className="label">to</span><input type="date" name="to" /></label>
              <label className="field"><span className="label">Project</span><select name="project" defaultValue=""><option value="">All projects</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="field"><span className="label">Source</span><select name="source" defaultValue=""><option value="">All sources</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="field"><span className="label">Assigned to</span><select name="agent" defaultValue=""><option value="">Everyone</option><option value="none">Not assigned</option>{(people ?? []).filter((p) => p.active).map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></label>
              <label className="field"><span className="label">Status</span><select name="stage" defaultValue=""><option value="">All</option>{STATUS_LIST.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}<option value="lost">Lost</option></select></label>
              <label className="field"><span className="label">Interest</span><select name="score" defaultValue=""><option value="">All</option>{SCORES.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}</select></label>
              <label className="field"><span className="label">Lead type</span><select name="seg" defaultValue=""><option value="">Primary and secondary</option><option value="primary">Primary only</option><option value="secondary">Secondary only</option></select></label>
            </div>
            <label className="check"><input type="checkbox" name="history" value="1" defaultChecked /> <span>Include the History sheet (calls, notes, visits)</span></label>
            <div><button className="btn primary">Download Excel file</button></div>
            <p className="hint">Managers get only the leads they can see. Mobile numbers stay as text, so Excel keeps every digit.</p>
          </form>
        </div>
      </section>
    </>
  );
}
