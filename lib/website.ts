import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The company's own client website (e.g. https://surestonev1.vercel.app), or null. Set on Lead sources. */
export async function websiteUrl(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await supabase.from('organizations').select('website_url').eq('id', orgId).maybeSingle();
  if (error) return null; // patch-022 not run yet
  const u = (data as { website_url?: string | null } | null)?.website_url ?? null;
  return u && /^https:\/\//.test(u) ? u.replace(/\/+$/, '') : null;
}
