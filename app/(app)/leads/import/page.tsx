import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { ImportLeads } from '@/components/ImportLeads';

export const metadata = { title: 'Import leads' };

export default async function ImportPage() {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const [{ data: people }, { data: projects }] = await Promise.all([
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id).eq('active', true).neq('role', 'partner').order('full_name'),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
  ]);
  return (
    <>
      <div className="top"><h1>Import leads</h1><Link className="btn ghost" href="/leads">Back to leads</Link></div>
      <p className="muted" style={{ marginTop: -8, maxWidth: '70ch' }}>Bring in your old Excel sheet or a list downloaded from a portal. Up to 20,000 rows at once.</p>
      <ImportLeads people={people ?? []} projects={projects ?? []} />
    </>
  );
}
