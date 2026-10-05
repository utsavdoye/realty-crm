import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { DealForm } from '@/components/DealForm';
import { todayIST } from '@/lib/money';

export const metadata = { title: 'New deal' };

export default async function NewDeal({ searchParams }: { searchParams: { lead?: string } }) {
  const { supabase, org } = await requireOrg(['owner']);
  const [{ data: lead }, { data: projects }, { data: people }] = await Promise.all([
    searchParams.lead ? supabase.from('leads').select('id, name, project_id, assigned_to, booked_at, budget_max').eq('id', searchParams.lead).eq('org_id', org.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id).neq('role', 'partner').order('full_name'),
  ]);
  return (
    <>
      <div className="top"><h1>New deal</h1><Link className="btn ghost" href="/money?tab=deals">Back</Link></div>
      <section className="panel narrow"><div className="panel-b" style={{ paddingTop: 16 }}>
        <DealForm isNew projects={projects ?? []} people={people ?? []} d={{
          lead_id: lead?.id, buyer_name: lead?.name ?? '', project_id: lead?.project_id, agent_id: lead?.assigned_to,
          booked_on: lead?.booked_at ? lead.booked_at.slice(0, 10) : todayIST(), agreement_value: lead?.budget_max ? lead.budget_max * 100000 : null,
        }} />
      </div></section>
    </>
  );
}
