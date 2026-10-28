import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtDT } from '@/lib/crm';

export const metadata = { title: 'Integrations' };

type Src = { kind: string; active: boolean; lead_count: number; last_lead_at: string | null };
type State = 'on' | 'half' | 'off' | 'soon';
type Card = { name: string; what: string; state: State; status: string; href?: string; cta?: string };

const has = (...k: string[]) => k.every((x) => !!process.env[x]);

export default async function Integrations() {
  const { supabase, org } = await requireOrg(['owner']);
  const [{ data: srcs }, { data: socials }, { data: o }] = await Promise.all([
    supabase.from('lead_sources').select('kind, active, lead_count, last_lead_at').eq('org_id', org.id),
    supabase.from('social_accounts').select('platform, name, active').eq('org_id', org.id).eq('active', true), // patch-039
    supabase.from('organizations').select('wa_phone_id').eq('id', org.id).maybeSingle(), // patch-040
  ]);
  const sources = (srcs ?? []) as Src[];
  const src = (kind: string): Pick<Card, 'state' | 'status'> => {
    const list = sources.filter((s) => s.kind === kind);
    if (!list.length) return { state: 'off', status: 'Not set up' };
    const n = list.reduce((a, s) => a + (s.lead_count ?? 0), 0);
    const last = list.map((s) => s.last_lead_at).filter(Boolean).sort().pop();
    if (!list.some((s) => s.active)) return { state: 'half', status: 'Turned off' };
    return { state: n ? 'on' : 'half', status: n ? `${n} leads · last ${fmtDT(last!)}` : 'Link made, no lead yet' };
  };
  const acc = (p: string) => (socials ?? []).filter((s) => s.platform === p);
  const waEnv = has('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
  const waOn = waEnv && !!(o as { wa_phone_id?: string | null } | null)?.wa_phone_id;
  const metaApp = has('META_APP_ID', 'META_APP_SECRET');

  const groups: { title: string; cards: Card[] }[] = [
    { title: 'Meta (Facebook, Instagram, WhatsApp)', cards: [
      { name: 'Facebook / Instagram lead ads', what: 'Leads from your ad forms come into the CRM in seconds and get assigned.', ...src('meta'), href: '/sources', cta: 'Set up' },
      { name: 'Facebook Page posts', what: 'Post projects to your Page from the CRM, now or on a schedule.', state: acc('facebook').length ? 'on' : metaApp ? 'half' : 'off', status: acc('facebook').length ? acc('facebook').map((a) => a.name).join(', ') : metaApp ? 'Ready — connect your Page' : 'Add META_APP_ID and META_APP_SECRET in Vercel', href: '/posts', cta: 'Open posts' },
      { name: 'Instagram posts', what: 'Post photos and reels to Instagram from the CRM.', state: acc('instagram').length ? 'on' : metaApp ? 'half' : 'off', status: acc('instagram').length ? acc('instagram').map((a) => a.name).join(', ') : metaApp ? 'Ready — connect with your Facebook Page' : 'Needs the Meta app keys first', href: '/posts', cta: 'Open posts' },
      { name: 'WhatsApp Business', what: 'Chat with clients inside the CRM, welcome new leads with the brochure, visit reminders.', state: waOn ? 'on' : waEnv ? 'half' : 'off', status: waOn ? 'Connected' : waEnv ? 'Keys added — press “Use this WhatsApp number”' : 'Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Vercel', href: '/whatsapp', cta: 'Open WhatsApp' },
    ] },
    { title: 'Property portals', cards: [
      { name: '99acres', what: 'Portal leads pushed straight into the CRM.', ...src('99acres'), href: '/sources', cta: 'Set up' },
      { name: 'MagicBricks', what: 'Portal leads pushed straight into the CRM.', ...src('magicbricks'), href: '/sources', cta: 'Set up' },
      { name: 'Housing.com', what: 'Portal leads pushed straight into the CRM.', ...src('housing'), href: '/sources', cta: 'Set up' },
    ] },
    { title: 'Your website and Google', cards: [
      { name: 'Website forms', what: 'Enquiries from your website become leads.', ...src('website'), href: '/sources', cta: 'Set up' },
      { name: 'Google Ads lead forms', what: 'Leads from Google Ads forms come in by webhook.', ...src('google'), href: '/sources', cta: 'Set up' },
      { name: 'YouTube', what: 'Upload project videos to your channel from the CRM.', state: acc('youtube').length ? 'on' : has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET') ? 'half' : 'off', status: acc('youtube').length ? acc('youtube').map((a) => a.name).join(', ') : has('GOOGLE_CLIENT_ID') ? 'Ready — connect your channel' : 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel', href: '/posts', cta: 'Open posts' },
      { name: 'Hindi translation', what: 'Project details are translated to Hindi for the website automatically.', state: has('GEMINI_API_KEY') ? 'on' : 'off', status: has('GEMINI_API_KEY') ? 'On' : 'Add GEMINI_API_KEY in Vercel' },
    ] },
    { title: 'Anything else', cards: [
      { name: 'Justdial, IndiaMART, Google Sheets, Zapier…', what: 'Any tool that can send a webhook can drop leads into the CRM using a general link.', ...src('generic'), href: '/sources', cta: 'Make a link' },
      { name: 'Excel / CSV', what: 'Upload old lead lists or cold-calling data.', state: 'on', status: 'Always available', href: '/cold', cta: 'Upload' },
      { name: 'Cloud calling (Exotel, Knowlarity)', what: 'Click to call, call recording and missed-call leads.', state: 'soon', status: 'Coming later' },
      { name: 'Email (Zoho / Gmail)', what: 'See client emails on the lead page.', state: 'soon', status: 'Coming later' },
    ] },
  ];
  const all = groups.flatMap((g) => g.cards).filter((c) => c.state !== 'soon');
  const on = all.filter((c) => c.state === 'on').length;

  return (
    <>
      <div className="top">
        <div className="top-title"><h1>Integrations</h1><span className="muted">Everything connected to the CRM in one place. {on} of {all.length} working.</span></div>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>Keys (tokens and secrets) are added only in Vercel → Settings → Environment Variables. Never paste them in chat or on this page.</p>
      {groups.map((g) => (
        <section key={g.title} style={{ marginBottom: 20 }}>
          <h2 className="int-h">{g.title}</h2>
          <div className="int-grid">
            {g.cards.map((c) => (
              <div key={c.name} className={`panel int-card s-${c.state}`}>
                <div className="int-top"><b>{c.name}</b><span className={`chip ${c.state === 'on' ? 'good' : c.state === 'half' ? 'tape' : ''}`}>{c.state === 'on' ? 'Working' : c.state === 'half' ? 'Almost' : c.state === 'soon' ? 'Soon' : 'Off'}</span></div>
                <p className="hint">{c.what}</p>
                <p className="int-status">{c.status}</p>
                {c.href && <Link href={c.href} className="btn sm">{c.cta ?? 'Open'}</Link>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
