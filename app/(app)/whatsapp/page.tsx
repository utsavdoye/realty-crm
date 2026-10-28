import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { whatsappReady } from '@/lib/whatsapp';
import { getChat, TPL_REMINDER, TPL_WELCOME } from '@/lib/waInbox';
import { saveWaSettings } from '@/app/wa-actions';
import { ActionForm, Submit } from '@/components/forms';
import { CopyButton } from '@/components/CopyButton';
import { WaComposer, WaRefresh, WaScroll } from '@/components/WaChat';
import { siteUrl } from '@/lib/roles';

export const metadata = { title: 'WhatsApp' };

type Chat = { id: string; phone: string; name: string | null; lead_id: string | null; last_text: string | null; last_at: string; last_in_at: string | null; unread: number };
type Msg = { id: string; dir: 'in' | 'out'; kind: string; body: string; media_id: string | null; media_mime: string | null; file_name: string | null; status: string; error: string | null; created_at: string };

const DAY = 24 * 60 * 60_000;
const t = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
const d = (s: string) => {
  const x = new Date(s); const today = new Date();
  return x.toDateString() === today.toDateString() ? t(s) : x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
};
const fmt = (p: string) => (p.length === 12 && p.startsWith('91') ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : `+${p}`);
const TICK: Record<string, string> = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠', received: '' };

export default async function WhatsAppPage({ searchParams }: { searchParams: { c?: string; lead?: string; q?: string } }) {
  const { supabase, org, role } = await requireOrg();
  const owner = role === 'owner';

  // Opened from a lead page → find or start that client's chat.
  if (searchParams.lead && /^[0-9a-f-]{36}$/i.test(searchParams.lead)) {
    const { data: lead } = await supabase.from('leads').select('id, name, phone').eq('id', searchParams.lead).eq('org_id', org.id).maybeSingle();
    const admin = createAdminClient();
    if (lead && admin) {
      const chat = await getChat(admin, org.id, lead.phone, { name: lead.name, leadId: lead.id }).catch(() => null);
      if (chat) redirect(`/whatsapp?c=${chat.id}`);
    }
  }

  const { data: o, error: oErr } = await supabase.from('organizations').select('wa_phone_id, wa_lead_source, wa_auto_welcome, wa_visit_reminders').eq('id', org.id).maybeSingle();
  const notRun = !!oErr && /wa_/.test(oErr.message);
  const ready = whatsappReady();
  const connected = ready && o?.wa_phone_id === process.env.WHATSAPP_PHONE_NUMBER_ID;
  const site = siteUrl();

  let chatsQ = supabase.from('wa_chats').select('id, phone, name, lead_id, last_text, last_at, last_in_at, unread').eq('org_id', org.id).order('last_at', { ascending: false }).limit(100);
  const q = (searchParams.q ?? '').trim().slice(0, 40).replace(/[%,()]/g, '');
  if (q) chatsQ = chatsQ.or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, '') || q}%`);
  const [{ data: chatRows }, { data: projectRows }, { data: sources }] = await Promise.all([
    notRun ? Promise.resolve({ data: [] }) : chatsQ,
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    owner ? supabase.from('lead_sources').select('key, name').eq('org_id', org.id).eq('active', true).order('created_at') : Promise.resolve({ data: [] }),
  ]);
  const chats = (chatRows ?? []) as Chat[];
  const projects = (projectRows ?? []) as { id: string; name: string }[];
  const cur = chats.find((c) => c.id === searchParams.c) ?? null;

  let msgs: Msg[] = [];
  let leadProject: string | null = null;
  if (cur) {
    const [{ data: m }, { data: l }] = await Promise.all([
      supabase.from('wa_messages').select('id, dir, kind, body, media_id, media_mime, file_name, status, error, created_at').eq('chat_id', cur.id).order('created_at', { ascending: false }).limit(200),
      cur.lead_id ? supabase.from('leads').select('project_id').eq('id', cur.lead_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    msgs = ((m ?? []) as Msg[]).reverse();
    leadProject = (l as { project_id?: string | null } | null)?.project_id ?? null;
  }
  const windowOpen = !!cur?.last_in_at && Date.now() - Date.parse(cur.last_in_at) < DAY;

  return (
    <div className="page-wa">
      <div className="top">
        <div className="top-title"><h1>WhatsApp</h1><span className="muted">Every client chat on the company number, inside the CRM.</span></div>
        <span className={`chip ${connected ? 'good' : 'bad'}`}>{connected ? 'Connected' : 'Not connected'}</span>
      </div>
      <WaRefresh />

      {notRun && <p className="msg err" style={{ marginBottom: 16 }}>Run <b>supabase/patch-040-whatsapp-inbox.sql</b> in Supabase → SQL Editor first.</p>}

      <div className={`wa-grid ${cur ? 'has-chat' : ''}`}>
        <section className="panel wa-list">
          <form className="wa-search"><input name="q" defaultValue={q} placeholder="Search name or number" /></form>
          {!chats.length && <p className="muted" style={{ padding: 16 }}>{q ? 'No chats match.' : 'No chats yet. Open a lead and press “Chat in CRM”, or wait for a client to message the company number.'}</p>}
          {chats.map((c) => (
            <Link key={c.id} href={`/whatsapp?c=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className={`wa-item ${c.id === cur?.id ? 'on' : ''}`} scroll={false}>
              <span className="wa-av">{(c.name || '#').slice(0, 1).toUpperCase()}</span>
              <span className="wa-meta">
                <span className="row-between"><b>{c.name || fmt(c.phone)}</b><span className="hint">{d(c.last_at)}</span></span>
                <span className="row-between"><span className="wa-last">{c.last_text || ''}</span>{c.unread > 0 && <span className="wa-badge">{c.unread}</span>}</span>
              </span>
            </Link>
          ))}
        </section>

        <section className="panel wa-thread">
          {!cur ? (
            <div className="wa-empty"><p className="muted">Pick a chat on the left.</p></div>
          ) : (
            <>
              <div className="wa-head">
                <Link href="/whatsapp" className="btn sm ghost wa-back">←</Link>
                <span className="wa-av">{(cur.name || '#').slice(0, 1).toUpperCase()}</span>
                <span className="wa-meta"><b>{cur.name || fmt(cur.phone)}</b><span className="hint">{fmt(cur.phone)}</span></span>
                {cur.lead_id ? <Link className="btn sm" href={`/leads/${cur.lead_id}`}>Open lead</Link> : <span className="chip">Not a lead yet</span>}
              </div>
              <div className="wa-msgs">
                {!msgs.length && <p className="muted" style={{ textAlign: 'center' }}>No messages yet. Send the welcome message to start.</p>}
                {msgs.map((m) => (
                  <div key={m.id} className={`wa-msg ${m.dir} ${m.status === 'failed' ? 'failed' : ''}`}>
                    {m.media_id && m.kind === 'image' && <a href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer"><img src={`/api/whatsapp/media/${m.id}`} alt="Photo from client" loading="lazy" /></a> /* eslint-disable-line @next/next/no-img-element */}
                    {m.media_id && m.kind === 'video' && <video src={`/api/whatsapp/media/${m.id}`} controls preload="none" />}
                    {m.media_id && m.kind === 'audio' && <audio src={`/api/whatsapp/media/${m.id}`} controls preload="none" />}
                    {m.media_id && m.kind === 'document' && <a className="wa-file" href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer">📄 {m.file_name || 'File'}</a>}
                    {!m.media_id && m.kind === 'document' && <span className="wa-file">📄 {m.file_name || 'File'}</span>}
                    {m.kind === 'template' && <span className="wa-tag">Template</span>}
                    {m.body && !(m.kind === 'audio' && m.body === 'Voice note') && <span className="wa-body">{m.body}</span>}
                    <span className="wa-time">{t(m.created_at)} {m.dir === 'out' && <i className={m.status === 'read' ? 'read' : ''}>{TICK[m.status] ?? ''}</i>}</span>
                    {m.error && <span className="wa-err">{m.error}</span>}
                  </div>
                ))}
                <WaScroll dep={msgs[msgs.length - 1]?.id ?? ''} />
              </div>
              {connected
                ? <WaComposer chatId={cur.id} windowOpen={windowOpen} unread={cur.unread} projects={projects} defaultProject={leadProject} />
                : <p className="hint" style={{ padding: 12 }}>Connect WhatsApp below to reply from here.</p>}
            </>
          )}
        </section>
      </div>

      {owner && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-h"><h2>WhatsApp settings</h2>{!ready && <span className="hint">Add the keys in Vercel first (steps below).</span>}</div>
          <div style={{ padding: '0 16px 16px' }}>
            <ActionForm action={saveWaSettings} className="stack">
              {ready && !connected && <label className="check"><input type="checkbox" name="connect" defaultChecked /> Use this WhatsApp number for {org.name}</label>}
              <label className="check"><input type="checkbox" name="wa_auto_welcome" defaultChecked={!!o?.wa_auto_welcome} /> New lead → send the welcome message with the project brochure link automatically</label>
              <label className="check"><input type="checkbox" name="wa_visit_reminders" defaultChecked={!!o?.wa_visit_reminders} /> Remind the client on WhatsApp before a site visit (needs the 5-minute timer)</label>
              <label className="field" style={{ maxWidth: 420 }}><span className="label">New people who message first become leads in</span>
                <select name="wa_lead_source" defaultValue={o?.wa_lead_source ?? ''}>
                  <option value="">A lead source with “WhatsApp” in its name (or none)</option>
                  {((sources ?? []) as { key: string; name: string }[]).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select></label>
              <div><Submit>Save</Submit></div>
            </ActionForm>

            <details className="setup" style={{ marginTop: 16 }} open={!ready}>
              <summary><b>How to connect the company number</b> <span className="hint">(one time)</span></summary>
              <ol>
                <li>The new number must <b>not</b> be on the WhatsApp or WhatsApp Business app. If it is, delete that WhatsApp account on the phone first.</li>
                <li><b>developers.facebook.com</b> → your app (the same one used for Posts is fine) → Add product → <b>WhatsApp</b> → pick or create the business portfolio.</li>
                <li>WhatsApp → API Setup → <b>Add phone number</b> → display name <b>The Astittva Estates</b> → verify with the SMS code.</li>
                <li>business.facebook.com → Settings → <b>System users</b> → add an Admin system user → assign the app and the WhatsApp account (full control) → <b>Generate token</b> with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>, expiry “Never”.</li>
                <li>Vercel → Environment Variables: <code>WHATSAPP_TOKEN</code> (that token), <code>WHATSAPP_PHONE_NUMBER_ID</code> (from API Setup), <code>WHATSAPP_VERIFY_TOKEN</code> (any long random word), and <code>META_APP_SECRET</code> if not added yet. Redeploy.</li>
                <li>WhatsApp → Configuration → Webhook: Callback URL <code>{site}/api/whatsapp/webhook</code> <CopyButton text={`${site}/api/whatsapp/webhook`} label="Copy" />, verify token = your <code>WHATSAPP_VERIFY_TOKEN</code>. Subscribe to <b>messages</b>.</li>
                <li>WhatsApp Manager → <b>Message templates</b> → create these two (language English):
                  <ul>
                    <li><code>{TPL_WELCOME()}</code> (Utility or Marketing): <i>Hi {'{{1}}'}, thank you for your interest in {'{{2}}'}. I am {'{{3}}'} from {'{{4}}'}. Here are the details and brochure: {'{{5}}'}. Reply here any time for prices, floor plans or a site visit.</i></li>
                    <li><code>{TPL_REMINDER()}</code> (Utility): <i>Hi {'{{1}}'}, a reminder of your site visit to {'{{2}}'} on {'{{3}}'}. {'{{4}}'} ({'{{5}}'}) will meet you there. Reply here if you need to change the time.</i></li>
                  </ul>
                </li>
                <li>Add a <b>payment method</b> in WhatsApp Manager (needed to message clients beyond the free test). Then come back here, tick “Use this WhatsApp number”, and Save.</li>
              </ol>
            </details>
          </div>
        </section>
      )}
    </div>
  );
}
