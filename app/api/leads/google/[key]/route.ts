import { ingest, KEY_RE, mapPayload } from '@/lib/leadIntake';

// Google Ads lead form webhook. In Google Ads, paste this link as the Webhook URL
// and paste the same secret key (shown on the Lead sources page) as the Key.
export const dynamic = 'force-dynamic';

type GooglePayload = {
  google_key?: string; is_test?: boolean; campaign_id?: number | string; form_id?: number | string;
  user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[];
};

const COLS: Record<string, string> = {
  FULL_NAME: 'name', FIRST_NAME: 'firstname', LAST_NAME: 'lastname', PHONE_NUMBER: 'phone', EMAIL: 'email',
  CITY: 'city', POSTAL_CODE: 'pincode', STREET_ADDRESS: 'address',
};

export async function POST(req: Request, { params }: { params: { key: string } }) {
  if (!KEY_RE.test(params.key)) return Response.json({ error: 'unknown link' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as GooglePayload;
  if (body.google_key !== params.key) return Response.json({ error: 'key does not match' }, { status: 401 });

  const flat: Record<string, string> = {};
  for (const c of body.user_column_data ?? []) {
    const k = (c.column_id && COLS[c.column_id]) || c.column_name || c.column_id || '';
    if (k && c.string_value) flat[k] = c.string_value;
  }
  if (body.is_test && !flat.phone) return Response.json({ ok: true, test: true });

  const r = await ingest(params.key, mapPayload(flat), { ...flat, campaign_id: body.campaign_id, form_id: body.form_id });
  // Google only needs a 200. Bad leads are logged, not retried forever.
  return Response.json({ ok: r.ok });
}
