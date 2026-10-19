import { createAnonClient } from '@/lib/supabase/admin';

// Website upvotes: POST { org, project, voter, on } → { ok, votes }. voter = random id kept in the visitor's browser.
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const org = String(b.org ?? ''), project = String(b.project ?? ''), voter = String(b.voter ?? '');
  if (!UUID.test(org) || !UUID.test(project) || !/^[a-f0-9]{32,64}$/.test(voter)) return json({ ok: false }, 400);
  const { data, error } = await createAnonClient().rpc('site_vote', { p_org: org.toLowerCase(), p_project: project.toLowerCase(), p_voter: voter, p_on: b.on !== false });
  if (error || !data) return json({ ok: false }, error ? 500 : 404);
  return json(data);
}
