import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { DealForm } from '@/components/DealForm';
import { todayIST } from '@/lib/money';

export const metadata = { title: 'New deal' };

export default async function NewDeal({ searchParams }: { searchParams: { lead?: string } }) {
  const { supabase, org } = await requireOrg(['owner']);
  const [{ data: lead }, { data: projects }, { data: people }, { data: brokers }] = await Promise.all([
    searchParams.lead ? supabase.from('leads').select('*').eq('id', searchParams.lead).eq('org_id', org.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id).neq('role', 'partner').order('full_name'),
    supabase.from('brokers').select('id, name, firm, default_pct').eq('org_id', org.id).eq('active', true).order('name'), // patch-044
  ]);
  return (
    <>
      <div className="top"><h1>Book property</h1><Link className="btn ghost" href="/money?tab=deals">Back</Link></div>
      <section className="panel narrow"><div className="panel-b" style={{ paddingTop: 16 }}>
        <DealForm isNew projects={projects ?? []} people={people ?? []} brokers={(brokers ?? []) as never} d={{
          lead_id: lead?.id, buyer_name: lead?.name ?? '', project_id: lead?.project_id, agent_id: lead?.assigned_to,
          booked_on: lead?.booked_at ? lead.booked_at.slice(0, 10) : todayIST(), broker_id: lead?.broker_id ?? null,
          broker_pct: lead?.broker_id ? (brokers ?? []).find((b) => b.id === lead.broker_id)?.default_pct ?? null : null, agreement_value: lead?.budget_max ? lead.budget_max * 100000 : null,
        }} />
      </div></section>
    </>
  );
}
