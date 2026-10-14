import Link from 'next/link';
import { fetchAll } from '@/lib/fetchAll';
import { telHref } from '@/lib/roles';
import { fmtTime, fuText, istAt, scoreLabel } from '@/lib/crm';
import { currentStep, stepLabel } from '@/lib/journey';
import { CallButton } from '@/components/CallButton';
import { CheckInButton } from '@/components/CheckInButton';
import type { SupabaseClient } from '@supabase/supabase-js';

type L = { id: string; name: string; phone: string; score: string; stage: string; next_follow_up: string | null; call_attempts: number; assigned_at: string | null; created_at: string; location: string | null; bhk: string | null };
type V = { id: string; at: string; lead_id: string; checkin_at: string | null; leads: { name: string; phone: string } | null; projects: { name: string } | null };

const NEXT: Record<string, string | null> = { call: 'presentation', presentation: 'visit', visit: 'followup', followup: null };

/** The employee's home: one list of what to do now, each with a big Call button. */
export async function DoNow({ supabase, orgId, userId, firstName }: { supabase: SupabaseClient; orgId: string; userId: string; firstName: string }) {
  const now = new Date().toISOString();
  const endToday = istAt(1, 0);
  const [leads, steps, { data: visits }, { data: teams }, { data: people }] = await Promise.all([
    fetchAll<L>(() => supabase.from('leads').select('id, name, phone, score, stage, next_follow_up, call_attempts, assigned_at, created_at, location, bhk')
      .eq('org_id', orgId).eq('assigned_to', userId).not('stage', 'in', '(booked,lost)').order('id'), 3000),
    fetchAll<{ lead_id: string; step: string }>(() => supabase.from('lead_steps').select('id, lead_id, step').eq('org_id', orgId).order('id'), 20000),
    supabase.from('visits').select('id, at, lead_id, checkin_at, leads(name, phone), projects(name)').eq('org_id', orgId).eq('agent_id', userId).eq('status', 'scheduled').gte('at', istAt(0, 0)).lt('at', endToday).order('at'),
    supabase.from('step_teams').select('step, user_id').eq('org_id', orgId),
    supabase.from('members').select('user_id, full_name').eq('org_id', orgId),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const done = new Map<string, Set<string>>();
  steps.forEach((s) => { const d = done.get(s.lead_id) ?? new Set<string>(); d.add(s.step); done.set(s.lead_id, d); });
  const teamNames = (k: string | null) => (k ? (teams ?? []).filter((t) => t.step === k).map((t) => nameOf.get(t.user_id)).filter(Boolean).join(' / ') : '') || null;
  const stepOf = (id: string) => currentStep(done.get(id) ?? new Set(['received']), false);
  const recent = Date.now() - 24 * 3600000;

  type Row = L & { why: string; tone: 'bad' | 'acc' | 'good' | ''; order: number };
  const rows: Row[] = [];
  for (const l of leads) {
    const handed = l.assigned_at && new Date(l.assigned_at).getTime() > recent;
    if (l.next_follow_up && l.next_follow_up < now) rows.push({ ...l, why: `Overdue: ${fuText(l.next_follow_up)}`, tone: 'bad', order: 1 });
    else if (!l.call_attempts) rows.push({ ...l, why: 'New: not called yet', tone: 'acc', order: 2 });
    else if (handed) rows.push({ ...l, why: 'Just handed to you', tone: 'acc', order: 2 });
    else if (l.next_follow_up && l.next_follow_up < endToday) rows.push({ ...l, why: `Call ${fmtTime(l.next_follow_up)} today`, tone: '', order: 3 });
  }
  rows.sort((a, b) => a.order - b.order || (a.next_follow_up ?? a.created_at).localeCompare(b.next_follow_up ?? b.created_at));
  const vis = (visits ?? []) as unknown as V[];
  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));

  return (
    <>
      <div className="top">
        <div>
          <h1>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {firstName}</h1>
          <p className="hint">{rows.length ? `${rows.length} call${rows.length === 1 ? '' : 's'} to make` : 'No calls waiting'}{vis.length ? ` · ${vis.length} site visit${vis.length === 1 ? '' : 's'} today` : ''} · {leads.length} client{leads.length === 1 ? '' : 's'} with you</p>
        </div>
        <Link href="/leads/new" className="btn primary">+ Add lead</Link>
      </div>

      {vis.length > 0 && (
        <section className="panel">
          <div className="panel-h"><h2>Site visits today</h2></div>
          <div className="donow">
            {vis.map((v) => (
              <div key={v.id} className="dn-row">
                <div className="dn-main"><Link href={`/leads/${v.lead_id}#visit`}><b>{v.leads?.name ?? 'Client'}</b></Link>
                  <span className="hint">{fmtTime(v.at)} · {v.projects?.name ?? 'Project not set'}{v.checkin_at ? ` · checked in ${fmtTime(v.checkin_at)}` : ''}</span>
                  {!v.checkin_at && <CheckInButton visitId={v.id} />}</div>
                {v.leads?.phone && <CallButton leadId={v.lead_id} name={v.leads.name} tel={telHref(v.leads.phone)} step={null} className="btn dn-call">📞 Call</CallButton>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-h"><h2>Do now</h2><span className="hint">Most urgent first</span></div>
        <div className="donow">
          {rows.map((l) => {
            const st = stepOf(l.id);
            const canFinish = st && ['call', 'presentation', 'followup'].includes(st);
            return (
              <div key={l.id} className="dn-row">
                <div className="dn-main">
                  <Link href={`/leads/${l.id}`}><b>{l.name}</b></Link>
                  <span className="dn-tags">
                    {st && <span className="chip acc">{stepLabel(st)}</span>}
                    <span className={`chip ${l.tone}`}>{l.why}</span>
                    <span className={`chip ${l.score}`}>{scoreLabel(l.score)}</span>
                  </span>
                  {(l.bhk || l.location) && <span className="hint">{[l.bhk, l.location].filter(Boolean).join(' · ')}</span>}
                </div>
                <CallButton leadId={l.id} name={l.name} tel={telHref(l.phone)} className="btn primary dn-call"
                  step={canFinish && st ? { k: st, label: stepLabel(st), next: teamNames(NEXT[st]) } : null}>📞 Call</CallButton>
              </div>
            );
          })}
          {!rows.length && <p className="empty">All done for now. New clients and follow-ups will show up here.</p>}
        </div>
      </section>
    </>
  );
}
