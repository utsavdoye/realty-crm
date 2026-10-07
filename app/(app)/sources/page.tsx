import { requireOrg } from '@/lib/context';
import { createSource, saveMetaToken, setAutoAssign, setReassignMinutes, toggleSource } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { CopyButton } from '@/components/CopyButton';
import { SourceKindPicker } from '@/components/SourceKindPicker';
import { siteUrl } from '@/lib/roles';
import { ShareButtons } from '@/components/ShareButtons';

export const metadata = { title: 'Lead sources' };

type Source = {
  id: string; name: string; kind: string; key: string; active: boolean; lead_count: number;
  last_lead_at: string | null; external_id: string | null; default_project_id: string | null;
};

const HOW: Record<string, string[]> = {
  '99acres': [
    'Log in to your 99acres advertiser account.',
    'Go to Settings → Lead Management → CRM integration / Push API.',
    'Paste the link below and save. If you do not see this option, call your 99acres account manager and ask them to "push leads to my CRM link". Send them the link.',
  ],
  magicbricks: [
    'Log in to your MagicBricks advertiser account.',
    'Go to Lead Delivery → Webhook / API, paste the link below and save.',
    'If the option is missing, ask your MagicBricks account manager to enable lead push to this link.',
  ],
  housing: [
    'Log in to your Housing.com seller dashboard.',
    'Go to Lead Settings → Real-time lead delivery / Webhook, paste the link below and save.',
    'If the option is missing, ask your Housing.com account manager to enable it.',
  ],
  website: [
    'Copy the form code below into your website, or ask your website developer to send form data to the link.',
    'Fields understood: name, mobile, email, city, budget, project, message.',
  ],
  google: [
    'In Google Ads, open your lead form asset → Lead delivery → Webhook integration.',
    'Paste the Webhook URL and the Key from below, then press "Send test data".',
  ],
  meta: [
    'Your Facebook page is matched by its page ID.',
    'Paste your page access token below (admins only). Steps are in LEAD-SOURCES.md.',
  ],
  generic: [
    'Use this link with any tool that can send a web request (Zapier, Pabbly, other CRMs).',
    'Send fields like name, mobile, email, budget, project, message as JSON or form data.',
  ],
};

export default async function Sources() {
  const { supabase, org, role } = await requireOrg(['owner', 'manager']);
  const [{ data: sources }, { data: projects }, { data: orgRow }] = await Promise.all([
    supabase.from('lead_sources').select('id, name, kind, key, active, lead_count, last_lead_at, external_id, default_project_id').eq('org_id', org.id).order('created_at'),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    supabase.from('organizations').select('*').eq('id', org.id).single(),
  ]);
  const base = siteUrl();
  const list = (sources ?? []) as Source[];
  const auto = (orgRow as { auto_assign?: boolean } | null)?.auto_assign ?? true;
  const reassign = (orgRow as { reassign_minutes?: number | null } | null)?.reassign_minutes ?? null;
  const formToken = (orgRow as { form_token?: string | null } | null)?.form_token ?? null;
  return (
    <>
      <div className="top"><h1>Lead sources</h1></div>
      <p className="muted" style={{ marginTop: -8, maxWidth: '70ch' }}>
        Connect each place your leads come from. New leads land in your CRM within seconds, go to the next agent automatically, and the agent gets a WhatsApp alert. A number that enquires again is added to the same lead, never copied.
      </p>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-h"><h2>Client requirement form</h2><span className="hint">Free · no portal needed</span></div>
        <div className="panel-b stack">
          <p className="hint">One link for the company: put it in your Instagram bio, WhatsApp status, Google profile and ads. Clients pick their budget, home type and area, and it becomes a lead (shared automatically). Each person also has their own link in Profile, so their clients come to them.</p>
          {formToken ? <ShareButtons url={`${siteUrl()}/r/${formToken}`} text="Looking for a home? Tell us your budget and area in 1 minute, and we will send you options that fit:" /> : <p className="msg err">Run patch-011 in Supabase to switch this on.</p>}
        </div>
      </section>

      <div className="grid-main">
        <div className="stack">
          {list.length === 0 && <section className="panel"><p className="empty">No lead sources yet. Add your first one on the right.</p></section>}
          {list.map((s) => {
            const link = s.kind === 'google' ? `${base}/api/leads/google/${s.key}` : s.kind === 'meta' ? `${base}/api/leads/meta` : `${base}/api/leads/in/${s.key}`;
            const project = projects?.find((p) => p.id === s.default_project_id)?.name;
            return (
              <section key={s.id} className={`panel ${s.active ? '' : 'off'}`}>
                <div className="panel-h">
                  <h2>{s.name}</h2>
                  <span className={`chip ${s.active ? 'good' : ''}`}>{s.active ? 'On' : 'Off'}</span>
                  <form action={toggleSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={String(!s.active)} />
                    <button className="btn sm ghost">{s.active ? 'Switch off' : 'Switch on'}</button>
                  </form>
                </div>
                <div className="panel-b stack">
                  <div className="hint">
                    {s.lead_count} lead{s.lead_count === 1 ? '' : 's'} received
                    {s.last_lead_at ? ` · last ${new Date(s.last_lead_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ' · nothing yet'}
                    {project ? ` · goes to project ${project}` : ''}
                  </div>
                  <div className="invite-box">
                    <span className="label">{s.kind === 'google' ? 'Webhook URL' : s.kind === 'meta' ? 'Callback URL (set once in your Meta app)' : 'Lead link'}</span>
                    <code className="link">{link}</code>
                    <div className="row-gap"><CopyButton text={link} /></div>
                    {s.kind === 'google' && (<><span className="label">Key</span><code className="link">{s.key}</code><div className="row-gap"><CopyButton text={s.key} label="Copy key" /></div></>)}
                    {s.kind === 'meta' && <span className="hint">Facebook page ID: {s.external_id}</span>}
                  </div>
                  <ol className="how">{(HOW[s.kind] ?? HOW.generic).map((t) => <li key={t}>{t}</li>)}</ol>
                  {s.kind === 'website' && (
                    <details>
                      <summary className="btn sm">Show website form code</summary>
                      <pre className="code">{`<form action="${link}" method="POST">
  <input name="name" placeholder="Your name" required>
  <input name="mobile" placeholder="Mobile number" required>
  <input name="email" type="email" placeholder="Email">
  <input name="budget" placeholder="Budget, e.g. 60-80 lakh">
  <input name="project" type="hidden" value="Project name">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input name="_redirect" type="hidden" value="https://your-site.com/thank-you">
  <button type="submit">Get a call back</button>
</form>`}</pre>
                    </details>
                  )}
                  {s.kind === 'meta' && role === 'owner' && (
                    <ActionForm action={saveMetaToken} className="stack">
                      <input type="hidden" name="id" value={s.id} />
                      <label className="field"><span className="label">Page access token</span><input name="token" type="password" autoComplete="off" placeholder="EAAG…" /></label>
                      <Submit className="btn sm">Save token</Submit>
                    </ActionForm>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Add a lead source</h2></div>
            <div className="panel-b">
              <ActionForm action={createSource} className="stack">
                <SourceKindPicker />
                <label className="field"><span className="label">Name shown on leads (optional)</span><input name="name" placeholder="e.g. 99acres – Lakeview" /></label>
                <label className="field"><span className="label">Send these leads to project (optional)</span>
                  <select name="project_id" defaultValue=""><option value="">Detect from the enquiry</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </label>
                <Submit>Add source</Submit>
              </ActionForm>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Who gets new leads</h2></div>
            <div className="panel-b stack">
              <p className="hint">{auto ? 'Each new lead goes to the active sales agent with the fewest open leads.' : 'New leads stay unassigned until a manager assigns them.'}</p>
              {role === 'owner' && (
                <form action={setAutoAssign}>
                  <input type="hidden" name="on" value={String(!auto)} />
                  <button className="btn sm">{auto ? 'Turn off automatic sharing' : 'Share new leads automatically'}</button>
                </form>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Not called in time?</h2></div>
            <div className="panel-b stack">
              <p className="hint">
                {reassign ? `If an agent does not call a new lead within ${reassign} minutes, it moves to the next agent (9 AM–8 PM only, at most twice). Both get an alert.` : 'Off. New leads stay with the first agent even if nobody calls.'}
              </p>
              {role === 'owner' && (
                <form action={setReassignMinutes} className="row-btns">
                  <select name="minutes" defaultValue={String(reassign ?? '')} aria-label="Minutes before moving the lead">
                    <option value="">Off</option>
                    {[10, 15, 30, 60].map((m) => <option key={m} value={m}>After {m} minutes</option>)}
                  </select>
                  <button className="btn sm">Save</button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
