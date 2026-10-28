import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone } from '@/lib/roles';
import { setWorkHours } from '@/app/work-actions';
import { ActionForm, Submit } from '@/components/forms';

export const metadata = { title: 'Attendance' };

type Day = { id: string; user_id: string; login_at: string; last_seen_at: string; logout_at: string | null; reopened: number; work_breaks: { start_at: string; end_at: string | null; reason: string | null }[] };
const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : '—');
const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${m % 60}m`; };
const TABS = [['all', 'All'], ['in', 'Working'], ['break', 'On break'], ['done', 'Day ended'], ['absent', 'Not in'], ['reopened', 'Reopened']] as const;

export default async function Attendance({ searchParams }: { searchParams: { day?: string; tab?: string } }) {
  const { supabase, org, role, user } = await requireOrg();
  const mgr = role === 'owner' || role === 'manager';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') && searchParams.day! <= today ? searchParams.day! : today;
  const tab = TABS.some(([k]) => k === searchParams.tab) ? searchParams.tab! : 'all';

  let q = supabase.from('work_days').select('id, user_id, login_at, last_seen_at, logout_at, reopened, work_breaks(start_at, end_at, reason)').eq('org_id', org.id).eq('day', day);
  if (!mgr) q = q.eq('user_id', user.id);
  const [{ data: days, error }, { data: people }, { data: o }] = await Promise.all([
    q, supabase.from('members').select('user_id, full_name, phone, role, active').eq('org_id', org.id).eq('active', true).neq('role', 'partner').order('full_name'),
    supabase.from('organizations').select('work_start, work_hours').eq('id', org.id).maybeSingle(),
  ]);
  const notRun = !!error && /work_days/.test(error.message);
  const start = String((o as { work_start?: string } | null)?.work_start ?? '10:00').slice(0, 5);
  const hours = Number((o as { work_hours?: number } | null)?.work_hours ?? 9);
  const byUser = new Map(((days ?? []) as Day[]).map((d) => [d.user_id, d]));
  const now = Date.now();
  const startMs = Date.parse(`${day}T${start}:00+05:30`);

  const cards = (people ?? []).filter((p) => mgr || p.user_id === user.id).map((p) => {
    const d = byUser.get(p.user_id);
    if (!d) return { p, d: null, state: 'absent' as const };
    const end = d.logout_at ? Date.parse(d.logout_at) : day === today ? now : Date.parse(d.last_seen_at);
    const total = end - Date.parse(d.login_at);
    const brk = d.work_breaks.reduce((a, b) => a + ((b.end_at ? Date.parse(b.end_at) : end) - Date.parse(b.start_at)), 0);
    const onBreak = d.work_breaks.some((b) => !b.end_at) && !d.logout_at;
    const work = total - brk;
    const late = Date.parse(d.login_at) - startMs > 10 * 60000;
    const over = work - hours * 3600000;
    const idle = !d.logout_at && day === today && now - Date.parse(d.last_seen_at) > 30 * 60000;
    return { p, d, total, brk, work, late, over, idle, state: (d.logout_at ? 'done' : onBreak ? 'break' : 'in') as 'done' | 'break' | 'in' };
  });
  const count = (k: string) => k === 'all' ? cards.length : k === 'reopened' ? cards.filter((c) => c.d && c.d.reopened > 0).length : cards.filter((c) => c.state === k).length;
  const shown = cards.filter((c) => tab === 'all' || (tab === 'reopened' ? c.d && c.d.reopened > 0 : c.state === tab));
  const href = (k: string) => `/attendance?tab=${k}${day !== today ? `&day=${day}` : ''}`;

  return (
    <>
      <div className="top">
        <div className="top-title"><h1>Attendance</h1><span className="muted">When each person started, breaks, and when they ended the day. Office time {start}, {hours} hours.</span></div>
        <form action="/attendance" className="row-btns"><input type="date" name="day" defaultValue={day} max={today} aria-label="Day" /><button className="btn sm">Show</button></form>
      </div>
      {notRun && <p className="msg err" style={{ marginBottom: 16 }}>Run <b>supabase/patch-045-attendance-cold-docs.sql</b> in Supabase → SQL Editor first.</p>}
      <p className="hint" style={{ marginBottom: 12 }}>The day starts by itself when someone opens the CRM and works in it. They press <b>Break</b>, <b>I&apos;m back</b> and <b>End day</b> at the top of any page.</p>
      {mgr && (
        <div className="seg" role="tablist" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) => <Link key={k} href={href(k)} className={tab === k ? 'on' : ''}>{l} ({count(k)})</Link>)}
        </div>
      )}
      <div className="att-grid">
        {shown.map(({ p, d, ...c }) => (
          <section key={p.user_id} className="panel att-card">
            <div className="panel-h">
              <h2>{p.full_name}</h2>
              {d ? <>
                {'late' in c && <span className={`chip ${c.late ? 'bad' : 'good'}`}>{c.late ? 'Late' : 'On time'}</span>}
                {'over' in c && c.over! > 15 * 60000 && <span className="chip acc">Overtime +{dur(c.over!)}</span>}
                <span className={`chip ${c.state === 'in' ? 'good' : c.state === 'break' ? 'tape' : ''}`}>{c.state === 'in' ? 'Working' : c.state === 'break' ? 'On break' : 'Day ended'}</span>
                {'idle' in c && c.idle && <span className="chip tape">No activity 30+ min</span>}
                {d.reopened > 0 && <span className="chip">Reopened {d.reopened}×</span>}
              </> : <span className="chip">{day === today ? 'Not in yet' : 'Absent'}</span>}
            </div>
            <div className="panel-b">
              <span className="hint">{p.phone ? fmtPhone(p.phone) : ''}</span>
              {d && 'total' in c && (
                <div className="att-kv">
                  <div><span className="label">Started</span><b>{t(d.login_at)}</b></div>
                  <div><span className="label">Last activity</span><b>{t(d.last_seen_at)}</b></div>
                  <div><span className="label">Ended</span><b>{t(d.logout_at)}</b></div>
                  <div><span className="label">Total time</span><b>{dur(c.total!)}</b></div>
                  <div><span className="label">Work time</span><b>{dur(c.work!)}</b></div>
                  <div><span className="label">Break time</span><b>{dur(c.brk!)}</b></div>
                </div>
              )}
              {d && d.work_breaks.length > 0 && <p className="hint">Breaks: {d.work_breaks.map((b) => `${t(b.start_at)}–${b.end_at ? t(b.end_at) : 'now'}${b.reason ? ` (${b.reason})` : ''}`).join(', ')}</p>}
            </div>
          </section>
        ))}
        {!shown.length && <p className="empty">Nobody here.</p>}
      </div>
      {role === 'owner' && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-h"><h2>Office hours</h2><span className="hint">Used for “On time / Late” and overtime</span></div>
          <div className="panel-b">
            <ActionForm action={setWorkHours as never} className="row-btns">
              <label className="field"><span className="label">Start time</span><input type="time" name="work_start" defaultValue={start} /></label>
              <label className="field"><span className="label">Hours a day</span><input type="number" name="work_hours" min={1} max={16} step={0.5} defaultValue={hours} /></label>
              <div style={{ alignSelf: 'end' }}><Submit className="btn sm primary">Save</Submit></div>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
