import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { deleteTemplate, saveTemplate } from '@/app/crm-actions';
import { ActionForm, Submit } from '@/components/forms';
import { TEMPLATE_USES, TEMPLATE_VARS, fillTemplate } from '@/lib/crm';

export const metadata = { title: 'Messages' };

type T = { id: string; name: string; use_for: string; body: string };

function Fields({ t }: { t?: T }) {
  return (
    <div className="stack">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid2f">
        <label className="field"><span className="label">Name</span><input name="name" required defaultValue={t?.name ?? ''} /></label>
        <label className="field"><span className="label">Used for</span><select name="use_for" defaultValue={t?.use_for ?? 'Follow-up'}>{TEMPLATE_USES.map((u) => <option key={u}>{u}</option>)}</select></label>
      </div>
      <label className="field"><span className="label">Message</span><textarea name="body" rows={8} required defaultValue={t?.body ?? ''} /></label>
      <p className="hint">These words get filled in for each client: {TEMPLATE_VARS.map((v) => `{{${v}}}`).join(' ')}</p>
    </div>
  );
}

export default async function Messages() {
  const { supabase, org, role, me } = await requireOrg();
  const mgr = isManager(role);
  const { data } = await supabase.from('templates').select('id, name, use_for, body').eq('org_id', org.id).order('use_for');
  const list = (data ?? []) as T[];
  const sample = { name: 'Rahul Mehta', agent: me.full_name, agent_phone: '98765 43210', company: org.name, project: 'Lakeview Heights', visit_time: 'Sun, 12 Oct, 11:00 am', budget: '₹80 L – 1 Cr', location: 'Whitefield', bhk: '3 BHK' };
  return (
    <>
      <div className="top"><h1>Message templates</h1></div>
      <p className="muted" style={{ marginTop: -8, maxWidth: '70ch' }}>Ready-made WhatsApp messages for clients. On a lead page, pick one and WhatsApp opens with the client&apos;s name, project and your number already filled in.</p>
      <div className="cards">
        {list.map((t) => (
          <div key={t.id} className="pcard">
            <span className="chip acc" style={{ alignSelf: 'flex-start' }}>{t.use_for}</span>
            <h2>{t.name}</h2>
            <div className="bubble" translate="no">{fillTemplate(t.body, sample)}</div>
            {mgr && (
              <details>
                <summary className="btn sm ghost">Edit</summary>
                <ActionForm action={saveTemplate} className="stack inline-box"><Fields t={t} /><Submit className="btn sm primary">Save</Submit></ActionForm>
                <form action={deleteTemplate} style={{ marginTop: 8 }}><input type="hidden" name="id" value={t.id} /><button className="btn sm ghost danger">Delete</button></form>
              </details>
            )}
          </div>
        ))}
        {!list.length && <div className="panel"><p className="empty">No templates yet.</p></div>}
      </div>
      {mgr && (
        <section className="panel narrow" style={{ marginTop: 16 }}>
          <div className="panel-h"><h2>New template</h2></div>
          <div className="panel-b"><ActionForm action={saveTemplate} className="stack"><Fields /><div><Submit>Save template</Submit></div></ActionForm></div>
        </section>
      )}
    </>
  );
}
