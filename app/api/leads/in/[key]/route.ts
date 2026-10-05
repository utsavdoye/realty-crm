import { ingest, KEY_RE, mapPayload } from '@/lib/leadIntake';

// One link per lead source: portals (99acres, MagicBricks, Housing.com), your website form, or any other tool.
// Accepts JSON, normal form posts, or values in the link itself (?name=..&mobile=..).
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

const MESSAGES: Record<string, [number, string]> = {
  unknown_key: [404, 'This lead link is not valid or was switched off.'],
  plan_ended: [402, 'This CRM account is not active.'],
  bad_phone: [422, 'A valid 10-digit mobile number is required.'],
  server_error: [500, 'Could not save the lead. Please try again.'],
};

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) return (await req.json()) as Record<string, unknown>;
    if (type.includes('form')) return Object.fromEntries((await req.formData()).entries()) as Record<string, unknown>;
    const text = await req.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
  } catch { return {}; }
}

async function handle(req: Request, key: string) {
  if (!KEY_RE.test(key)) return Response.json({ ok: false, error: MESSAGES.unknown_key[1] }, { status: 404, headers: CORS });
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const body = req.method === 'POST' ? await readBody(req) : {};
  const payload = { ...query, ...body };

  // Hidden "website" field on forms catches spam bots.
  if (typeof payload.website === 'string' && payload.website.trim()) return Response.json({ ok: true }, { headers: CORS });

  const r = await ingest(key, mapPayload(payload), payload);

  // Plain HTML forms: send the visitor to a thank-you page if one is given.
  const thanks = String(payload._redirect || payload.redirect || '');
  if (thanks && /^https?:\/\//.test(thanks) && (req.headers.get('accept') || '').includes('text/html')) {
    return Response.redirect(thanks, 303);
  }
  if (!r.ok) {
    const [status, msg] = MESSAGES[r.error ?? 'server_error'] ?? MESSAGES.server_error;
    return Response.json({ ok: false, error: msg }, { status, headers: CORS });
  }
  return Response.json({ ok: true, duplicate: !r.is_new }, { headers: CORS });
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export function GET(req: Request, { params }: { params: { key: string } }) { return handle(req, params.key); }
export function POST(req: Request, { params }: { params: { key: string } }) { return handle(req, params.key); }
