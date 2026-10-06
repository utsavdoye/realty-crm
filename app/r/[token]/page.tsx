import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/admin';
import { RequirementForm } from '@/components/public/RequirementForm';

export const dynamic = 'force-dynamic';
type Data = { company: string; city: string | null; advisor: string | null; areas: string[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function load(token: string, by?: string) {
  if (!/^[a-f0-9]{24,64}$/.test(token)) return null;
  const { data } = await createAnonClient().rpc('get_requirement_form', { p_form: token, p_by: by && UUID.test(by) ? by : null });
  return (data as Data | null) ?? null;
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const d = await load(params.token);
  return d
    ? { title: `Find your home with ${d.company}`, description: 'Tell us what you are looking for. We will send you homes that fit your budget.', robots: { index: false } }
    : { title: 'Link not active', robots: { index: false } };
}

export default async function RequirementPage({ params, searchParams }: { params: { token: string }; searchParams: { by?: string } }) {
  const by = searchParams.by && UUID.test(searchParams.by) ? searchParams.by : '';
  const d = await load(params.token, by);
  if (!d) return <main className="pub"><div className="pub-wrap"><h1>This link is not active</h1><p className="muted">Please ask the person who sent it for a new link.</p></div></main>;
  return (
    <main className="pub">
      <header className="pub-head"><div className="pub-wrap row-gap"><b className="pub-brand">{d.company}</b></div></header>
      <div className="pub-wrap req-wrap">
        <section className="req-hero">
          <span className="chip acc">Free · takes 1 minute</span>
          <h1>Tell us your dream home.<br />We find it for you.</h1>
          <p className="muted">
            {d.advisor ? <><b>{d.advisor}</b> will personally shortlist homes </> : 'Our advisor will shortlist homes '}
            {d.city ? `in ${d.city} ` : ''}that fit your budget, and call you. No spam, no pressure.
          </p>
        </section>
        <RequirementForm token={params.token} by={by} areas={d.areas ?? []} advisor={d.advisor} />
      </div>
      <footer className="pub-foot pub-wrap hint">{d.company} · We use your number only to help you find a home.</footer>
    </main>
  );
}
