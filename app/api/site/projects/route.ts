import { createAnonClient } from '@/lib/supabase/admin';

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
  return Response.json({ ok: true, projects: data, contact: contact ?? null }, {
    headers: { ...CORS, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
  });
}
