import { createAdminClient, createAnonClient } from '@/lib/supabase/admin';

// Projects for your client website (e.g. Surestone): /api/site/projects?org=<company id>
// Public and read-only. Only projects marked "Show on website" (and not sold out). Updates within a minute.
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(req: Request) {
  const org = new URL(req.url).searchParams.get('org') ?? '';
  if (!UUID.test(org)) return Response.json({ ok: false, error: 'Missing or wrong company id.' }, { status: 400, headers: CORS });
  const db = createAnonClient();
  const [{ data, error }, { data: contact }] = await Promise.all([
    db.rpc('site_projects', { p_org: org.toLowerCase() }),
    db.rpc('site_contact', { p_org: org.toLowerCase() }), // patch-023; null before it is run
  ]);
  if (error) { console.error('site_projects failed:', error.message); return Response.json({ ok: false, error: 'Could not load projects.' }, { status: 500, headers: CORS }); }
  if (data == null) return Response.json({ ok: false, error: 'This company was not found or its plan has ended.' }, { status: 404, headers: CORS });
  // Hindi copy of each project (patch-041), for the website's हिंदी mode.
  let projects = data as { id: string; hi?: unknown }[];
  const admin = createAdminClient();
  if (admin && Array.isArray(projects) && projects.length) {
    const { data: hi } = await admin.from('projects').select('id, hi').eq('org_id', org.toLowerCase()).not('hi', 'is', null);
    if (hi?.length) { const m = new Map(hi.map((r) => [r.id as string, r.hi])); projects = projects.map((p) => (m.has(p.id) ? { ...p, hi: m.get(p.id) } : p)); }
  }
  return Response.json({ ok: true, projects, contact: contact ?? null }, {
    headers: { ...CORS, 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=20' },
  });
}
