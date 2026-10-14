import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/context';
import { fetchAll, realDay } from '@/lib/fetchAll';
import { makeXlsx, type Cell } from '@/lib/xlsx';
import { SCORE_KEYS, STAGE_IDX, fmtBudget, fmtDT, fmtDate, scoreLabel, stageLabel } from '@/lib/crm';
import { fmtPhone, isManager } from '@/lib/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Excel download of leads (admins and managers; a manager gets only the leads they can see).
 * Filters: month=2026-10 or from/to dates, project, source, agent, stage, score, seg. Two sheets: Leads and History.
 */
export async function GET(req: Request) {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role)) return NextResponse.json({ error: 'Only admins and managers can export.' }, { status: 403 });
  const u = new URL(req.url).searchParams;
  let from = u.get('from'), to = u.get('to');
  const month = u.get('month');
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of that month
  }
  const project = u.get('project'), source = u.get('source'), agent = u.get('agent'), stage = u.get('stage'), score = u.get('score'), seg = u.get('seg');
  const withHistory = u.get('history') === '1';

  const leads = await fetchAll<Record<string, unknown>>(() => {
    let q = supabase.from('leads').select('*').eq('org_id', org.id);
    if (realDay(from)) q = q.gte('created_at', `${from}T00:00:00+05:30`);
    if (realDay(to)) q = q.lte('created_at', `${to}T23:59:59+05:30`);
    if (project && UUID.test(project)) q = q.eq('project_id', project);
    if (source) q = q.eq('source', source.slice(0, 60));
    if (agent === 'none') q = q.is('assigned_to', null); else if (agent && UUID.test(agent)) q = q.eq('assigned_to', agent);
    if (stage && (STAGE_IDX[stage] != null || stage === 'lost')) q = q.eq('stage', stage);
    if (score && SCORE_KEYS.includes(score)) q = q.eq('score', score);
    if (seg === 'primary' || seg === 'secondary') q = q.eq('segment', seg);
    return q.order('created_at').order('id');
  }, 100000);

  const [{ data: people }, { data: projects }] = await Promise.all([
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id),
    supabase.from('projects').select('id, name').eq('org_id', org.id),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const projOf = new Map((projects ?? []).map((p) => [p.id, p.name]));

  // History (calls, notes, visits …) for these leads, newest first
  const ids = new Set(leads.map((l) => l.id as string));
  const acts = withHistory && ids.size
    ? (await fetchAll<{ lead_id: string; type: string; body: string; by_user: string | null; created_at: string }>(() => {
        let q = supabase.from('activities').select('lead_id, type, body, by_user, created_at').eq('org_id', org.id);
        if (realDay(from)) q = q.gte('created_at', `${from}T00:00:00+05:30`);
        return q.order('created_at', { ascending: false }).order('id');
      }, 200000)).filter((a) => ids.has(a.lead_id))
    : [];
  const lastNote = new Map<string, string>();
  for (const a of acts) if (!lastNote.has(a.lead_id) && ['note', 'call', 'visit', 'step'].includes(a.type) && a.by_user) lastNote.set(a.lead_id, a.body.replace(/\s+/g, ' ').slice(0, 300));
  const leadName = new Map(leads.map((l) => [l.id as string, [l.name as string, l.phone as string]]));

  const s = (v: unknown) => (v == null ? '' : String(v));
  const head = ['Name', 'Mobile', 'Email', 'Status', 'Interest', 'Category', 'Configuration', 'Property type', 'Budget', 'Budget from (₹ lakh)', 'Budget to (₹ lakh)',
    'Area wanted', 'City', 'Pincode', 'Purpose', 'Funding', 'Occupation', 'Project', 'Source', 'Lead type', 'Assigned to', 'Next follow-up', 'Came in', 'Lost reason', 'Date of birth', 'Latest note'];
  const rows: Cell[][] = [head, ...leads.map((l) => [
    s(l.name), fmtPhone(s(l.phone)), s(l.email), stageLabel(s(l.stage)), scoreLabel(s(l.score)), s(l.category), s(l.bhk), s(l.property_type),
    fmtBudget(l.budget_min as number | null, l.budget_max as number | null), l.budget_min as number | null, l.budget_max as number | null,
    s(l.location), s(l.city), s(l.pincode), s(l.purpose), s(l.funding), s(l.occupation),
    (l.project_id && projOf.get(l.project_id as string)) || s(l.project_other), s(l.source), l.segment === 'secondary' ? 'Secondary' : 'Primary',
    l.assigned_to ? nameOf.get(l.assigned_to as string) ?? '' : 'Not assigned', fmtDT(l.next_follow_up as string | null), fmtDT(l.created_at as string),
    s(l.lost_reason), fmtDate(l.dob as string | null), lastNote.get(l.id as string) ?? '',
  ])];
  const TYPE: Record<string, string> = { call: 'Call', note: 'Note', visit: 'Site visit', whatsapp: 'WhatsApp', stage: 'Status', assign: 'Assigned', created: 'Lead added', enquiry: 'Enquiry', step: 'Step done' };
  const hist: Cell[][] = [['When', 'Client', 'Mobile', 'What', 'By', 'Details'],
    ...acts.map((a) => [fmtDT(a.created_at), leadName.get(a.lead_id)?.[0] ?? '', fmtPhone(leadName.get(a.lead_id)?.[1] ?? ''), TYPE[a.type] ?? a.type, a.by_user ? nameOf.get(a.by_user) ?? '' : 'Automatic', a.body])];

  const file = makeXlsx([
    { name: 'Leads', rows, widths: [22, 15, 24, 14, 11, 13, 13, 15, 18, 10, 10, 22, 12, 9, 12, 16, 16, 20, 14, 10, 18, 20, 20, 18, 13, 50] },
    ...(withHistory ? [{ name: 'History', rows: hist, widths: [20, 22, 15, 12, 18, 80] }] : []),
  ]);
  const label = month && /^\d{4}-\d{2}$/.test(month) ? month : realDay(from) || realDay(to) ? `${from ?? 'start'}-to-${to ?? 'today'}` : 'all';
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="leads-${label}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
