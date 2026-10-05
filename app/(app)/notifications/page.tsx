import { requireOrg } from '@/lib/context';
import { markAllRead, openNotification } from '@/app/actions';
import { rel } from '@/lib/crm';

export const metadata = { title: 'Alerts' };

type N = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export default async function Notifications() {
  const { supabase, user } = await requireOrg();
  const { data } = await supabase.from('notifications').select('id, type, title, body, link, read_at, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
  const list = (data ?? []) as N[];
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <div className="top">
        <h1>Alerts</h1>
        {unread > 0 && <form action={markAllRead}><button className="btn sm">Mark all as read</button></form>}
      </div>
      <section className="panel narrow">
        {list.length ? list.map((n) => (
          <form key={n.id} action={openNotification} className={`notif ${n.read_at ? 'read' : 'unread'}`}>
            <input type="hidden" name="id" value={n.id} />
            <span className="ndot" aria-hidden="true" />
            <span className="nmain">
              <b>{n.title}</b>
              {n.body && <span className="hint">{n.body}</span>}
              <span className="hint">{rel(n.created_at)}</span>
            </span>
            <button className="btn sm ghost">{n.link ? 'Open' : 'OK'}</button>
          </form>
        )) : <p className="empty">No alerts yet. You will see one here when a lead is given to you.</p>}
      </section>
    </>
  );
}
