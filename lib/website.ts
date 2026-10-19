import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The company's own client website (e.g. https://surestonev1.vercel.app), or null. Set on Lead sources. */
export async function websiteUrl(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await supabase.from('organizations').select('website_url').eq('id', orgId).maybeSingle();
  if (error) return null; // patch-022 not run yet
  const u = (data as { website_url?: string | null } | null)?.website_url ?? null;
  return u && /^https:\/\//.test(u) ? u.replace(/\/+$/, '') : null;
}

/** The number clients call from the website (patch-023), or null. */
export async function websitePhone(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await supabase.from('organizations').select('website_phone').eq('id', orgId).maybeSingle();
  if (error) return null;
  return (data as { website_phone?: string | null } | null)?.website_phone ?? null;
}

/** Is SMS verification switched on (patch-026)? */
export async function websiteVerify(supabase: SupabaseClient, orgId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('organizations').select('verify_phone').eq('id', orgId).maybeSingle();
  if (error) return null;
  return !!(data as { verify_phone?: boolean } | null)?.verify_phone;
}
