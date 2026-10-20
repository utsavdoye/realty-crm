import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type Check = { name: string; ok: boolean | null; detail: string; fix?: string };

function jwtRole(key: string): string | null {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role ?? null; } catch { return null; }
}

/** Checks the settings the website link needs. Never shows secret values. */
export async function systemCheck(website: string | null): Promise<Check[]> {
  const out: Check[] = [];

  // 1. Supabase service role key
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const admin = createAdminClient();
  if (!key) {
    out.push({ name: 'Supabase service role key', ok: false, detail: 'Not added in Vercel.', fix: 'Vercel → realty-crm → Settings → Environment Variables → add SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API Keys → service_role / secret). Then Redeploy.' });
  } else if (key.startsWith('sb_publishable_') || (key.startsWith('eyJ') && jwtRole(key) !== 'service_role')) {
    out.push({ name: 'Supabase service role key', ok: false, detail: 'A key is added, but it is the public (anon / publishable) key, not the secret one.', fix: 'Replace it with the service_role / secret key from Supabase → Project Settings → API Keys. Then Redeploy.' });
  } else {
    const { error } = await admin!.from('organizations').select('id').limit(1);
    out.push(error
      ? { name: 'Supabase service role key', ok: false, detail: `Added, but Supabase refused it: ${error.message}`, fix: 'Copy the service_role / secret key again (no spaces) from the same Supabase project, save it in Vercel, then Redeploy.' }
      : { name: 'Supabase service role key', ok: true, detail: 'Added and working.' });
  }

  // 2. Firebase project id (website accounts + SMS check)
  const fb = process.env.FIREBASE_PROJECT_ID ?? '';
  let siteFb: string | null = null;
  if (website) {
    try {
      const js = await (await fetch(`${website}/firebase-config.js`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })).text();
      siteFb = /projectId\s*:\s*['"]([a-z0-9-]+)['"]/.exec(js)?.[1] ?? null;
    } catch { /* website not reachable */ }
  }
  if (!fb) {
    out.push({ name: 'Firebase project id', ok: false, detail: 'Not added in Vercel, so website sign-ins cannot reach the CRM.', fix: `Vercel → Environment Variables → add FIREBASE_PROJECT_ID = ${siteFb ?? 'your Firebase project id (e.g. surestone-e3a9e)'}. Then Redeploy.` });
  } else if (siteFb && siteFb !== fb) {
    out.push({ name: 'Firebase project id', ok: false, detail: `Vercel has "${fb}" but your website uses "${siteFb}".`, fix: `Change FIREBASE_PROJECT_ID in Vercel to ${siteFb}, then Redeploy.` });
  } else {
    let google = true;
    try { google = (await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', { cache: 'no-store', signal: AbortSignal.timeout(4000) })).ok; } catch { google = false; }
    out.push(google
      ? { name: 'Firebase project id', ok: true, detail: `Set to "${fb}"${siteFb ? ', same as your website' : ''}. Sign-ins can be checked.` }
      : { name: 'Firebase project id', ok: false, detail: `Set to "${fb}", but Google's sign-in keys could not be reached from the server right now.`, fix: 'Try again in a minute.' });
  }

  // 3. Database updates (patches)
  if (admin && out[0].ok) {
    const probe = async (name: string, fix: string, q: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q();
      out.push(error ? { name, ok: false, detail: 'Not run yet.', fix } : { name, ok: true, detail: 'Done.' });
    };
    await probe('Database: upvotes (patch-024)', 'Run supabase/patch-024-first-call-lock-votes.sql in Supabase → SQL Editor.', () => admin.from('project_votes').select('project_id').limit(1));
    await probe('Database: SMS check (patch-026)', 'Run supabase/patch-026-phone-verify.sql.', () => admin.from('organizations').select('verify_phone').limit(1));
    await probe('Database: website accounts and saves (patch-027)', 'Run supabase/patch-027-website-accounts-saves.sql.', () => admin.from('website_saves').select('id').limit(1));
    await probe('Database: website sign-ins become leads (patch-029)', 'Run supabase/patch-029-website-clients-as-leads.sql.', () => admin.from('website_clients').select('lead_id').limit(1));
    await probe('Database: website alerts and testimonials (patch-032)', 'Run supabase/patch-032-website-alerts-testimonials.sql.', () => admin.from('testimonials').select('id').limit(1));
    const { data: st, error: stErr } = await admin.rpc('setup_status');
    if (stErr || !st) {
      out.push({ name: 'Database: alerts for repeat enquiries and sellers (patch-031)', ok: false, detail: 'Not run yet.', fix: 'Run supabase/patch-031-repeat-enquiry-alerts.sql.' });
      out.push({ name: 'Database: live updates (patch-028, patch-030)', ok: null, detail: 'Can be checked after patch-031 is run.' });
    } else {
      const rt: string[] = st.realtime ?? [];
      out.push(st.repeat_alerts ? { name: 'Database: alerts for repeat enquiries and sellers (patch-031)', ok: true, detail: 'Done.' } : { name: 'Database: alerts for repeat enquiries and sellers (patch-031)', ok: false, detail: 'Not run yet.', fix: 'Run supabase/patch-031-repeat-enquiry-alerts.sql.' });
      out.push(rt.includes('project_votes') && rt.includes('website_saves') ? { name: 'Database: live upvotes and saves (patch-028)', ok: true, detail: 'Done.' } : { name: 'Database: live upvotes and saves (patch-028)', ok: false, detail: 'Not run yet (counts still update every 10 seconds).', fix: 'Run supabase/patch-028-live-counts.sql.' });
      out.push(rt.includes('notifications') ? { name: 'Database: live alerts (patch-030)', ok: true, detail: 'Done.' } : { name: 'Database: live alerts (patch-030)', ok: false, detail: 'Not run yet (alerts still update every 15 seconds).', fix: 'Run supabase/patch-030-live-alerts.sql.' });
    }
  }
  return out;
}
