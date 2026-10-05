import { createAdminClient } from '@/lib/supabase/admin';
import { sendTemplate, whatsappReady } from '@/lib/whatsapp';
import { istAt } from '@/lib/crm';

// Runs every morning (see vercel.json). Sends each person one WhatsApp:
// "Good morning Priya! Today: 6 calls due, 2 overdue, 1 site visit."
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin || !whatsappReady()) return Response.json({ skipped: 'WhatsApp or service key not set' });

  const now = new Date().toISOString();
  const endToday = istAt(1, 0);
  const [{ data: orgs }, { data: members }, { data: leads }, { data: visits }] = await Promise.all([
    admin.from('organizations').select('id, plan_status, trial_ends_at'),
    admin.from('members').select('org_id, user_id, full_name, phone, role').eq('active', true).not('phone', 'is', null).neq('role', 'partner'),
    admin.from('leads').select('org_id, assigned_to, next_follow_up').lt('next_follow_up', endToday).not('stage', 'in', '(booked,lost)').limit(50000),
    admin.from('visits').select('org_id, agent_id').eq('status', 'scheduled').gte('at', istAt(0, 0)).lt('at', endToday).limit(20000),
  ]);
  const live = new Set((orgs ?? []).filter((o) => o.plan_status === 'active' || (o.plan_status === 'trial' && o.trial_ends_at > now)).map((o) => o.id));

  let sent = 0, failed = 0;
  for (const m of members ?? []) {
    if (!live.has(m.org_id)) continue;
    const team = m.role === 'owner' || m.role === 'manager';
    const mine = (leads ?? []).filter((l) => l.org_id === m.org_id && (team || l.assigned_to === m.user_id));
    const overdue = mine.filter((l) => l.next_follow_up! < now).length;
    const due = mine.length - overdue;
    const vis = (visits ?? []).filter((v) => v.org_id === m.org_id && (team || v.agent_id === m.user_id)).length;
    if (!overdue && !due && !vis) continue;
    const r = await sendTemplate(m.phone!, process.env.WHATSAPP_TEMPLATE_DAILY || 'daily_summary', [
      (m.full_name || '').split(' ')[0] || 'there', String(due), String(overdue), String(vis),
    ]);
    if (r.ok) sent++; else { failed++; console.error('Daily summary failed for', m.user_id, r.error); }
  }
  return Response.json({ sent, failed });
}
