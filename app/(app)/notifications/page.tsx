import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { markAllRead, markAlertsRead, openNotification } from '@/app/actions';
import { rel } from '@/lib/crm';
import { GROUPS, groupOf, dayBucket, type AlertGroup } from '@/lib/alerts';
import { LiveRefresh } from '@/components/LiveRefresh';

export const metadata = { title: 'Alerts' };

type N = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
type Params = { g?: string; only?: string; view?: string; q?: string };
const LIMIT = 500;
const BUCKETS = ['Today', 'Yesterday', 'This week', 'Earlier'];

function leadOf(n: N) { const m = /^\/leads\/([0-9a-f-]{36})/.exec(n.link ?? ''); return m ? m[1] : null; }

function Row({ n, more }: { n: N; more?: N[] }) {
  const g = GROUPS.find((x) => x.key === groupOf(n.type))!;
  const unreadMore = (more ?? []).filter((x) => !x.read_at).length;
  return (
    <div className={`notif al-${g.key} ${n.read_at ? 'read' : 'unread'}`}>
      <span className="al-ico" aria-hidden="true">{g.icon}</span>
      <span className="nmain">
        <b>{n.title}</b>
        {n.body && <span className="hint">{n.body}</span>}
        <span className="hint">{rel(n.created_at)}{n.read_at ? '' : ' · new'}</span>
        {more && more.length > 0 && (
          <details className="al-more">
            <summary className="hint">+{more.length} earlier about this client{unreadMore ? ` (${unreadMore} new)` : ''}</summary>
            <ul>{more.map((m) => <li key={m.id} className={m.read_at ? '' : 'unread'}><b>{m.title}</b>{m.body ? <span className="hint"> · {m.body}</span> : null}<span className="hint"> · {rel(m.created_at)}</span></li>)}</ul>
          </details>
        )}
      </span>
      <span className="al-acts">
        <form action={openNotification}><input type="hidden" name="id" value={n.id} /><button className="btn sm ghost">{n.link ? 'Open' : 'OK'}</button></form>
        {!n.read_at && <form action={markAlertsRead}><input type="hidden" name="id" value={n.id} /><button className="btn sm ghost" title="Mark as read" aria-label="Mark as read">✓</button></form>}
      </span>
    </div>
  );
}

export default async function Notifications({ searchParams }: { searchParams?: Params }) {
  const { supabase, user, org } = await requireOrg();
  const sp = searchParams ?? {};
  const group = (GROUPS.some((x) => x.key === sp.g) ? sp.g : 'all') as AlertGroup | 'all';
  const onlyUnread = sp.only === 'new';
  const view = sp.view === 'client' ? 'client' : 'time';
  const q = (sp.q ?? '').trim().toLowerCase().slice(0, 60);

  const { data } = await supabase.from('notifications').select('id, type, title, body, link, read_at, created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(LIMIT);
  const all = (data ?? []) as N[];

  // counts per group (unread / total) for the tabs
  const count = new Map<string, { n: number; u: number }>();
  all.forEach((a) => { const k = groupOf(a.type); const c = count.get(k) ?? { n: 0, u: 0 }; c.n++; if (!a.read_at) c.u++; count.set(k, c); });
  const unreadAll = all.filter((a) => !a.read_at).length;

  let list = all;
  if (group !== 'all') list = list.filter((a) => groupOf(a.type) === group);
  if (onlyUnread) list = list.filter((a) => !a.read_at);
  if (q) list = list.filter((a) => (a.title + ' ' + (a.body ?? '')).toLowerCase().includes(q));

  // client names for "By client"
  const leadIds = Array.from(new Set(list.map(leadOf).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  for (let i = 0; i < leadIds.length && view === 'client'; i += 150) {
    const { data: ls } = await supabase.from('leads').select('id, name').eq('org_id', org.id).in('id', leadIds.slice(i, i + 150));
    (ls ?? []).forEach((l: { id: string; name: string }) => names.set(l.id, l.name));
  }

  const href = (p: Partial<Params>) => {
    const u = new URLSearchParams();
    const v = { g: group === 'all' ? '' : group, only: onlyUnread ? 'new' : '', view: view === 'client' ? 'client' : '', q, ...p };
    Object.entries(v).forEach(([k, x]) => { if (x) u.set(k, String(x)); });
    const s = u.toString();
    return '/notifications' + (s ? '?' + s : '');
  };
  const info = GROUPS.find((x) => x.key === group);

  // By time: day sections; several alerts about the same client in one day are stacked into one row
  const byDay = BUCKETS.map((b) => {
    const items = list.filter((a) => dayBucket(a.created_at) === b);
    const stacks: { top: N; more: N[] }[] = [];
    const seen = new Map<string, { top: N; more: N[] }>();
    items.forEach((a) => {
      const k = leadOf(a);
      if (k && seen.has(k)) { seen.get(k)!.more.push(a); return; }
      const s = { top: a, more: [] as N[] }; stacks.push(s); if (k) seen.set(k, s);
    });
    return { b, stacks, total: items.length, unread: items.filter((a) => !a.read_at).length };
  }).filter((x) => x.total);

  // By client: one card per client, the client with the newest unread alert first
  const clients = new Map<string, N[]>();
  list.forEach((a) => { const k = leadOf(a) ?? 'other'; clients.set(k, [...(clients.get(k) ?? []), a]); });
  const clientCards = Array.from(clients.entries()).sort(([ka, a], [kb, b]) => {
    if (ka === 'other') return 1; if (kb === 'other') return -1;
    const ua = a.some((x) => !x.read_at) ? 1 : 0, ub = b.some((x) => !x.read_at) ? 1 : 0;
    return ub - ua || b[0].created_at.localeCompare(a[0].created_at);
  });

  return (
    <>
      <LiveRefresh tables={['notifications']} orgId={org.id} />
      <div className="top">
        <h1>Alerts {unreadAll > 0 && <span className="al-total">{unreadAll} new</span>}</h1>
        <div className="row-gap">
          {group !== 'all' && (count.get(group)?.u ?? 0) > 0 && <form action={markAlertsRead}><input type="hidden" name="group" value={group} /><button className="btn sm ghost">Mark {info?.label.toLowerCase()} as read</button></form>}
          {unreadAll > 0 && <form action={markAllRead}><button className="btn sm">Mark all as read</button></form>}
        </div>
      </div>

      <nav className="al-tabs" aria-label="Alert groups">
        <Link href={href({ g: '' })} className={group === 'all' ? 'on' : ''}>All{unreadAll ? <i>{unreadAll}</i> : null}</Link>
        {GROUPS.map((x) => {
          const c = count.get(x.key);
          return <Link key={x.key} href={href({ g: x.key })} className={`al-tab-${x.key} ${group === x.key ? 'on' : ''}`}>{x.icon} {x.label}{c?.u ? <i>{c.u}</i> : <em>{c?.n ?? 0}</em>}</Link>;
        })}
      </nav>

      <div className="al-bar">
        <div className="seg">
          <Link href={href({ only: '' })} className={!onlyUnread ? 'on' : ''}>All</Link>
          <Link href={href({ only: 'new' })} className={onlyUnread ? 'on' : ''}>Only new</Link>
        </div>
        <div className="seg">
          <Link href={href({ view: '' })} className={view === 'time' ? 'on' : ''}>By time</Link>
          <Link href={href({ view: 'client' })} className={view === 'client' ? 'on' : ''}>By client</Link>
        </div>
        <form action="/notifications" className="al-search">
          {group !== 'all' && <input type="hidden" name="g" value={group} />}
          {onlyUnread && <input type="hidden" name="only" value="new" />}
          {view === 'client' && <input type="hidden" name="view" value="client" />}
          <input name="q" defaultValue={q} placeholder="Search a client or project" aria-label="Search alerts" />
          {q && <Link href={href({ q: '' })} className="hint">Clear</Link>}
        </form>
      </div>
      {info && <p className="hint al-hint">{info.hint}</p>}

      {!list.length ? (
        <section className="panel narrow"><p className="empty">{all.length ? 'Nothing here. Try another group or turn off “Only new”.' : 'No alerts yet. You will see one here when a lead is given to you.'}</p></section>
      ) : view === 'time' ? (
        byDay.map((d) => (
          <section key={d.b} className="panel narrow al-sec">
            <div className="al-sec-h"><b>{d.b}</b><span className="hint">{d.total} alert{d.total === 1 ? '' : 's'}{d.unread ? ` · ${d.unread} new` : ''}</span></div>
            {d.stacks.map((s) => <Row key={s.top.id} n={s.top} more={s.more} />)}
          </section>
        ))
      ) : (
        clientCards.map(([k, items]) => {
          const u = items.filter((x) => !x.read_at).length;
          const name = k === 'other' ? 'Team and other alerts' : names.get(k) ?? items[0].title.split(/[:]| opened| is | sent| enquired/)[0];
          return (
            <section key={k} className="panel narrow al-sec">
              <div className="al-sec-h">
                <b>{name}</b>
                <span className="hint">{items.length} alert{items.length === 1 ? '' : 's'}{u ? ` · ${u} new` : ''} · last {rel(items[0].created_at)}</span>
                {k !== 'other' && <Link className="btn sm ghost" href={`/leads/${k}`}>Open client</Link>}
              </div>
              {items.slice(0, 6).map((n) => <Row key={n.id} n={n} />)}
              {items.length > 6 && <details className="al-more al-pad"><summary className="hint">Show {items.length - 6} older</summary>{items.slice(6).map((n) => <Row key={n.id} n={n} />)}</details>}
            </section>
          );
        })
      )}
      {all.length >= LIMIT && <p className="hint">Showing your latest {LIMIT} alerts.</p>}
    </>
  );
}
