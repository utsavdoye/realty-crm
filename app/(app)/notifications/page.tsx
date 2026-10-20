import { requireOrg } from '@/lib/context';
import { markAllRead, markAlertsRead, openNotification } from '@/app/actions';
import { rel } from '@/lib/crm';
import { LiveRefresh } from '@/components/LiveRefresh';

export const metadata = { title: 'Alerts' };

type N = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export default async function Notifications() {
  const { supabase, user, org } = await requireOrg();
  const { data } = await supabase.from('notifications').select('id, type, title, body, link, read_at, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
  const list = (data ?? []) as N[];
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <LiveRefresh tables={['notifications']} orgId={org.id} />
      <div className="top">
        <h1>Alerts</h1>
        {unread > 0 && <form action={markAllRead}><button className="btn sm">Mark all as read</button></form>}
      </div>
      <section className="panel narrow">
        {list.length ? list.map((n) => (
          <div key={n.id} className={`notif ${n.read_at ? 'read' : 'unread'}`}>
            <span className="ndot" aria-hidden="true" />
            <span className="nmain">
              <b>{n.title}</b>
              {n.body && <span className="hint">{n.body}</span>}
            </span>
            <span className="ntime" title={new Date(n.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}>{rel(n.created_at)}</span>
            <span className="nacts">
              <form action={openNotification}><input type="hidden" name="id" value={n.id} /><button className="btn sm ghost">{n.link ? 'Open' : 'OK'}</button></form>
              {!n.read_at && n.link && <form action={markAlertsRead}><input type="hidden" name="id" value={n.id} /><button className="btn sm ghost" title="Mark as read" aria-label="Mark as read">✓</button></form>}
            </span>
          </div>
        )) : <p className="empty">No alerts yet. You will see one here when a lead is given to you.</p>}
      </section>
    </>
  );
}
