import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { createLeadFull } from '@/app/crm-actions';
import { ActionForm, Submit } from '@/components/forms';
import { LeadFields } from '@/components/LeadFields';
import { VoiceFill } from '@/components/VoiceFill';

export const metadata = { title: 'Add lead' };

export default async function NewLead() {
  const { supabase, org, role } = await requireOrg();
  const [{ data: projects }, { data: people }] = await Promise.all([
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name, role').eq('org_id', org.id).eq('active', true).neq('role', 'partner').order('full_name'),
  ]);
  return (
    <>
      <div className="top"><h1>Add lead</h1><Link className="btn ghost" href="/leads">Cancel</Link></div>
      <section className="panel narrow">
        <div className="panel-b" style={{ paddingTop: 16 }}>
          <ActionForm action={createLeadFull} className="stack">
            <VoiceFill enabled={Boolean(process.env.GEMINI_API_KEY)} />
            <LeadFields projects={projects ?? []} people={people ?? []} showAssign={isManager(role)} showNote lead={{ source: role === 'partner' ? 'Channel partner' : undefined }} />
            <div><Submit>Save lead</Submit></div>
          </ActionForm>
        </div>
      </section>
    </>
  );
}
