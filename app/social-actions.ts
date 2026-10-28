'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { runDuePosts, runPost, type Media, type Result } from '@/lib/social';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mgr = () => requireOrg(['owner', 'manager']);

export type NewPost = { caption: string; title?: string; media: Media[]; targets: string[]; mode: 'now' | 'schedule' | 'draft'; scheduledAt?: string };

/** Make a post, and publish it now / at a time / keep as draft. */
export async function createPost(input: NewPost): Promise<{ ok?: string; error?: string; id?: string; status?: string; results?: Record<string, Result> }> {
  const { supabase, org } = await mgr();
  const caption = String(input.caption ?? '').trim().slice(0, 2200);
  const media = (Array.isArray(input.media) ? input.media : []).filter((m) => m && typeof m.url === 'string' && m.url.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/project-photos/${org.id}/posts/`))
    .slice(0, 10).map((m) => ({ url: m.url, type: m.type === 'video' ? 'video' : 'image', size: Number(m.size) || undefined, w: Number(m.w) || undefined, h: Number(m.h) || undefined }));
  const targets = (Array.isArray(input.targets) ? input.targets : []).filter((t) => UUID.test(t));
  if (!media.length) return { error: 'Add a photo or a video.' };
  if (media.some((m) => m.type === 'video') && media.length > 1) return { error: 'A post can have one video, or up to 10 photos (not both).' };
  if (input.mode !== 'draft' && !targets.length) return { error: 'Choose where to post.' };
  let scheduled: string | null = null;
  if (input.mode === 'schedule') {
    const t = Date.parse(String(input.scheduledAt ?? ''));
    if (!Number.isFinite(t) || t < Date.now() + 60_000) return { error: 'Pick a time at least a minute from now.' };
    scheduled = new Date(t).toISOString();
  }
  const { data, error } = await supabase.from('social_posts').insert({
    org_id: org.id, caption, title: String(input.title ?? '').trim().slice(0, 100) || null, media, targets,
    status: input.mode === 'draft' ? 'draft' : input.mode === 'schedule' ? 'scheduled' : 'publishing', scheduled_at: scheduled,
  }).select('id').single();
  if (error || !data) return { error: /social_posts/.test(error?.message ?? '') ? 'Run supabase/patch-039-social-posting.sql in Supabase first.' : error?.message || 'Could not save the post.' };
  revalidatePath('/posts');
  if (input.mode === 'draft') return { ok: 'Saved as a draft.', id: data.id };
  if (input.mode === 'schedule') return { ok: `Scheduled for ${new Date(scheduled!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.`, id: data.id };
  const r = await runPost(data.id).catch((e) => ({ status: 'failed', results: {}, error: (e as Error).message }));
  revalidatePath('/posts');
  const msg = r.status === 'done' ? 'Posted everywhere.' : r.status === 'publishing' ? 'Posted. Instagram is still processing the video; it will go live in a minute or two.' : r.status === 'partial' ? 'Posted on some accounts. See the errors below.' : 'Could not post. See the errors below.';
  return { ...(r.status === 'failed' ? { error: msg } : { ok: msg }), id: data.id, status: r.status, results: r.results };
}

export async function publishDraft(id: string) {
  const { supabase, org } = await mgr();
  if (!UUID.test(id)) return { error: 'Post not found.' };
  const { data } = await supabase.from('social_posts').select('targets').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!data?.targets?.length) return { error: 'Choose where to post first (edit the draft).' };
  const r = await runPost(id).catch((e) => ({ status: 'failed', results: {}, error: (e as Error).message }));
  revalidatePath('/posts');
  return r.status === 'failed' ? { error: 'Could not post. See the errors below.' } : { ok: 'Done.' };
}

/** Retry the accounts that failed. */
export async function retryPost(id: string) {
  const { supabase, org } = await mgr();
  if (!UUID.test(id)) return { error: 'Post not found.' };
  const { data } = await supabase.from('social_posts').select('id').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!data) return { error: 'Post not found.' };
  const r = await runPost(id).catch(() => ({ status: 'failed' }));
  revalidatePath('/posts');
  return { ok: `Status: ${r.status}` };
}

export async function deletePost(id: string) {
  const { supabase, org } = await mgr();
  const { data } = await supabase.from('social_posts').select('media, status').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!data) return { error: 'Post not found.' };
  await supabase.from('social_posts').delete().eq('id', id).eq('org_id', org.id);
  // Files are kept if the post went live (Facebook/Instagram keep their own copy anyway); drafts clean up.
  if (data.status === 'draft' || data.status === 'scheduled') {
    const marker = '/storage/v1/object/public/project-photos/';
    const paths = ((data.media ?? []) as Media[]).map((m) => m.url.split(marker)[1]).filter(Boolean);
    if (paths.length) await supabase.storage.from('project-photos').remove(paths);
  }
  revalidatePath('/posts');
  return { ok: 'Deleted from the CRM. Posts already live stay on Facebook / Instagram / YouTube.' };
}

/** Runs when the Posts page is open: publishes due scheduled posts and finishes Instagram videos. */
export async function runDueNow(): Promise<{ ran: number }> {
  const { org } = await mgr();
  const r = await runDuePosts(org.id, 40_000);
  if (r.ran) revalidatePath('/posts');
  return r;
}

export async function setAccountActive(id: string, on: boolean) {
  const { supabase, org } = await mgr();
  const { error } = await supabase.from('social_accounts').update({ active: !!on }).eq('id', id).eq('org_id', org.id);
  revalidatePath('/posts');
  return error ? { error: error.message } : { ok: on ? 'On' : 'Off' };
}

export async function disconnectAccount(id: string) {
  const { supabase, org } = await requireOrg(['owner']);
  const { error } = await supabase.from('social_accounts').delete().eq('id', id).eq('org_id', org.id);
  revalidatePath('/posts');
  return error ? { error: error.message } : { ok: 'Disconnected.' };
}

/** Facebook / Instagram lead forms → this lead source. */
export async function setMetaLeadSource(key: string) {
  const { supabase, org } = await requireOrg(['owner']);
  const { error } = await supabase.rpc('set_meta_lead_source', { p_org: org.id, p_key: key || null });
  revalidatePath('/posts');
  return error ? { error: /set_meta_lead_source/.test(error.message) ? 'Run patch-039 in Supabase first.' : error.message } : { ok: 'Saved.' };
}

/** AI writes the caption (English + a Hinglish line) with hashtags. Uses the free Gemini key. */
export async function aiCaption(about: string, project: string, tone: string): Promise<{ caption?: string; title?: string; error?: string }> {
  const { org } = await mgr();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: 'Add GEMINI_API_KEY in Vercel to use AI captions.' };
  const prompt = `Write a social media post for a real estate company in India.
Company: ${org.name}. City: ${org.city || 'Raipur'} (also Naya Raipur / Atal Nagar and Bangalore).
What the post is about: ${String(about).slice(0, 600)}
Project (if any): ${String(project).slice(0, 120)}
Tone: ${tone || 'premium, warm, trustworthy'}.
Rules: 60–120 words. A strong first line. Mainly English with one short natural Hinglish line. Clear call to action (DM / call / book a site visit).
Do not invent prices, offers, sizes or dates that are not given above. 8–12 relevant hashtags at the end (mix of local like #Raipur #NayaRaipur and real estate ones).
Also give a short YouTube title (max 70 characters).`;
  for (const model of [process.env.GEMINI_CAPTION_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest']) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { caption: { type: 'STRING' }, title: { type: 'STRING' } }, required: ['caption'] } },
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = await res.json().catch(() => null);
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    try { const out = JSON.parse(text) as { caption?: string; title?: string }; if (out.caption) return { caption: out.caption.slice(0, 2200), title: (out.title ?? '').slice(0, 95) }; } catch { /* next model */ }
  }
  return { error: 'AI could not write it right now. Try again in a minute.' };
}
