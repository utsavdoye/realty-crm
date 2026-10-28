import { requireOrg } from '@/lib/context';
import { googleReady, metaReady, googleRedirect, metaRedirect, type Media, type Result } from '@/lib/social';
import { siteUrl } from '@/lib/roles';
import { PostComposer, type Account } from '@/components/PostComposer';
import { AccountButtons, MetaLeadSource, PostButtons } from '@/components/PostActions';
import { CopyButton } from '@/components/CopyButton';

export const metadata = { title: 'Posts' };
export const maxDuration = 60;

type Post = { id: string; caption: string; title: string | null; media: Media[]; targets: string[]; status: string; scheduled_at: string | null; results: Record<string, Result>; created_at: string; published_at: string | null };

const PLATFORM = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube' } as const;
const STATUS: Record<string, [string, string]> = {
  draft: ['Draft', ''], scheduled: ['Scheduled', 'acc'], publishing: ['Posting…', 'tape'],
  done: ['Live', 'good'], partial: ['Partly posted', 'bad'], failed: ['Failed', 'bad'],
};
const when = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export default async function PostsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { supabase, org, role } = await requireOrg(['owner', 'manager']);
  const owner = role === 'owner';

  const [acc, posts, projects, sources, orgRow] = await Promise.all([
    supabase.from('social_accounts').select('id, platform, name, picture, active').eq('org_id', org.id).order('platform'),
    supabase.from('social_posts').select('id, caption, title, media, targets, status, scheduled_at, results, created_at, published_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(30),
    supabase.from('projects').select('name').eq('org_id', org.id).order('name'),
    supabase.from('lead_sources').select('key, name').eq('org_id', org.id).eq('active', true).order('created_at'),
    supabase.from('organizations').select('meta_lead_source').eq('id', org.id).maybeSingle(),
  ]);

  const notRun = acc.error && /social_accounts/.test(acc.error.message);
  const accounts = (acc.data ?? []) as Account[];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const list = (posts.data ?? []) as Post[];
  const meta = metaReady(), google = googleReady(), ai = Boolean(process.env.GEMINI_API_KEY);
  const has = (p: Account['platform']) => accounts.some((a) => a.platform === p);
  const site = siteUrl();

  return (
    <div className="page-posts">
      <div className="top">
        <div className="top-title"><h1>Posts</h1><span className="muted">Make a post once. It goes to Facebook, Instagram and YouTube in one click.</span></div>
      </div>

      {searchParams.ok && <p className="msg ok" style={{ marginBottom: 16 }}>{searchParams.ok}</p>}
      {searchParams.error && <p className="msg err" style={{ marginBottom: 16 }}>{searchParams.error}</p>}

      {notRun ? (
        <section className="panel"><div className="panel-h"><h2>One step first</h2></div>
          <p className="muted" style={{ padding: '0 16px 16px' }}>Run <b>supabase/patch-039-social-posting.sql</b> in Supabase → SQL Editor, then open this page again.</p>
        </section>
      ) : (
        <div className="posts-grid">
          <div className="stack">
            <section className="panel">
              <div className="panel-h"><h2>New post</h2></div>
              <div style={{ padding: '0 16px 16px' }}>
                {accounts.some((a) => a.active)
                  ? <PostComposer orgId={org.id} accounts={accounts} projects={(projects.data ?? []).map((p) => p.name as string)} aiOn={ai} />
                  : <p className="muted">Connect your Facebook Page, Instagram or YouTube on the right to start posting.</p>}
              </div>
            </section>

            <section className="panel">
              <div className="panel-h"><h2>Recent posts</h2><span className="hint">{list.length ? `${list.length} shown` : ''}</span></div>
              {!list.length && <p className="muted" style={{ padding: '0 16px 16px' }}>No posts yet.</p>}
              <div className="rows">
                {list.map((p) => {
                  const [label, tone] = STATUS[p.status] ?? [p.status, ''];
                  const first = p.media?.[0];
                  return (
                    <div key={p.id} className="post-row">
                      <div className="post-thumb">
                        {first?.type === 'video' ? <video src={first.url} muted playsInline preload="metadata" /> : first ? <img src={first.url} alt="" loading="lazy" /> /* eslint-disable-line @next/next/no-img-element */ : null}
                        {p.media.length > 1 && <i>{p.media.length}</i>}
                      </div>
                      <div className="post-main">
                        <div className="row-between">
                          <span className={`chip ${tone}`}>{label}</span>
                          <span className="hint">{p.status === 'scheduled' && p.scheduled_at ? `Goes out ${when(p.scheduled_at)}` : when(p.published_at || p.created_at)}</span>
                        </div>
                        <p className="post-caption">{p.caption || <span className="muted">No caption</span>}</p>
                        <div className="post-results">
                          {p.targets.map((t) => {
                            const a = byId.get(t); const r = p.results?.[t];
                            const name = a ? `${PLATFORM[a.platform]}${a.name ? ` · ${a.name}` : ''}` : 'Removed account';
                            if (r?.ok) return <a key={t} className="chip good" href={r.url || '#'} target="_blank" rel="noreferrer">✓ {name}</a>;
                            if (r?.error) return <span key={t} className="chip bad" title={r.error}>✕ {name}: {r.error.slice(0, 90)}</span>;
                            if (r?.step === 'container') return <span key={t} className="chip tape">… {name}: processing</span>;
                            return <span key={t} className="chip">{name}</span>;
                          })}
                        </div>
                        <PostButtons id={p.id} status={p.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="stack">
            <section className="panel">
              <div className="panel-h"><h2>Connected accounts</h2></div>
              <div className="rows">
                {accounts.map((a) => (
                  <div key={a.id} className="callrow">
                    {a.picture ? <img src={a.picture} alt="" className="acc-pic" /> /* eslint-disable-line @next/next/no-img-element */ : <span className="acc-pic" />}
                    <span className="cr-main"><b>{a.name || 'Account'}</b><span className="hint"><span className={`pf pf-${a.platform}`}>{PLATFORM[a.platform]}</span>{a.active ? '' : ' · off'}</span></span>
                    <AccountButtons id={a.id} active={a.active} owner={owner} />
                  </div>
                ))}
              </div>
              <div className="stack" style={{ padding: 16, gap: 10 }}>
                {meta
                  ? <a className="btn block" href="/api/social/meta/start">{has('facebook') ? 'Reconnect / add Facebook + Instagram' : 'Connect Facebook + Instagram'}</a>
                  : <SetupMeta site={site} />}
                {google
                  ? <a className="btn block" href="/api/social/google/start">{has('youtube') ? 'Reconnect / add YouTube' : 'Connect YouTube'}</a>
                  : <SetupGoogle />}
                {has('youtube') && <p className="hint">YouTube note: until Google reviews your app, videos upload as <b>private</b>. Make them public in YouTube Studio, or apply for the free YouTube API audit once.</p>}
                {!ai && <p className="hint">Add <code>GEMINI_API_KEY</code> in Vercel to get the “Write with AI” caption button.</p>}
              </div>
            </section>

            {meta && (
              <section className="panel">
                <div className="panel-h"><h2>Facebook / Instagram lead ads</h2></div>
                <div className="stack" style={{ padding: '0 16px 16px', gap: 10 }}>
                  <p className="hint">When someone fills an instant form on your Facebook or Instagram ad, they appear here as a lead in seconds, with a WhatsApp and call alert to the agent.</p>
                  {owner ? <MetaLeadSource value={(orgRow.data?.meta_lead_source as string) ?? ''} sources={(sources.data ?? []) as { key: string; name: string }[]} /> : null}
                  <p className="hint">Leads go to this lead source. Make one called “Facebook ads” in Lead sources if you want them counted separately.</p>
                </div>
              </section>
            )}

            {(meta || google) && (
              <section className="panel">
                <div className="panel-h"><h2>Scheduled posts</h2></div>
                <div className="stack" style={{ padding: '0 16px 16px', gap: 10 }}>
                  <p className="hint">Scheduled posts go out while this page is open. To send them even when nobody has the CRM open, ask Claude to set up the free 5-minute timer (needs <code>CRON_SECRET</code> in Vercel). It calls:</p>
                  <span className="row-btns"><code className="code-pill">{site}/api/cron/social</code><CopyButton text={`${site}/api/cron/social`} /></span>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function SetupMeta({ site }: { site: string }) {
    return (
      <details className="setup">
        <summary><b>Set up Facebook + Instagram</b> <span className="hint">(one time, about 20 minutes)</span></summary>
        <ol>
          <li>Make a <b>Facebook Page</b> for the company. Make an <b>Instagram</b> account, switch it to <b>Professional → Business</b>, and link it to the Page (Instagram → Settings → Accounts Center).</li>
          <li>Go to <b>developers.facebook.com</b> → My Apps → Create app → type <b>Business</b>.</li>
          <li>Add the products <b>Facebook Login for Business</b>, <b>Instagram</b> and <b>Webhooks</b>.</li>
          <li>Facebook Login → Settings → Valid OAuth Redirect URIs: <code>{metaRedirect()}</code></li>
          <li>Webhooks → Page → callback <code>{site}/api/social/meta/webhook</code>, verify token = the value of <code>META_WEBHOOK_VERIFY_TOKEN</code>. Subscribe to <b>leadgen</b>.</li>
          <li>In Vercel → Settings → Environment Variables add <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, <code>META_WEBHOOK_VERIFY_TOKEN</code> (any long random word), then redeploy.</li>
          <li>Come back here and press <b>Connect</b>. While the app is in development mode only people with a role in the app can connect, which is fine for your own company.</li>
        </ol>
      </details>
    );
  }
  function SetupGoogle() {
    return (
      <details className="setup">
        <summary><b>Set up YouTube</b> <span className="hint">(one time, about 15 minutes)</span></summary>
        <ol>
          <li>Make a <b>YouTube channel</b> for the company (on the company Google account).</li>
          <li><b>console.cloud.google.com</b> → new project → APIs &amp; Services → enable <b>YouTube Data API v3</b>.</li>
          <li>OAuth consent screen → External → add your email as a test user.</li>
          <li>Credentials → Create OAuth client ID → Web application → Authorized redirect URI: <code>{googleRedirect()}</code></li>
          <li>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in Vercel, redeploy, then press <b>Connect YouTube</b>.</li>
        </ol>
      </details>
    );
  }
}
