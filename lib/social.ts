import 'server-only';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/roles';

// One-click posting to the company's Facebook Page, Instagram and YouTube, with the official APIs.
// Keys live in social_secrets, which only the server key can read.

export const GRAPH = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}`;
const GRAPH_VIDEO = `https://graph-video.facebook.com/${process.env.META_API_VERSION || 'v21.0'}`;

export const metaReady = () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
export const googleReady = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export type Media = { url: string; type: 'image' | 'video'; size?: number; w?: number; h?: number };
export type Platform = 'facebook' | 'instagram' | 'youtube';
export type Result = { ok?: boolean; url?: string; id?: string; error?: string; at?: string; step?: 'container'; container?: string };

// ---------- signed "state" for the connect buttons (who started it, for which company) ----------
const stateKey = () => process.env.META_APP_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
export function makeState(orgId: string, userId: string) {
  const body = Buffer.from(JSON.stringify({ o: orgId, u: userId, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function readState(state: string): { o: string; u: string } | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as { o: string; u: string; t: number };
  return Date.now() - s.t < 15 * 60_000 ? s : null;
}

export const metaRedirect = () => `${siteUrl()}/api/social/meta/callback`;
export const googleRedirect = () => `${siteUrl()}/api/social/google/callback`;

export function metaConnectUrl(state: string) {
  const scope = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata', 'leads_retrieval', 'instagram_basic', 'instagram_content_publish', 'business_management'].join(',');
  const u = new URL(`https://www.facebook.com/${process.env.META_API_VERSION || 'v21.0'}/dialog/oauth`);
  u.searchParams.set('client_id', process.env.META_APP_ID!);
  u.searchParams.set('redirect_uri', metaRedirect());
  u.searchParams.set('state', state);
  u.searchParams.set('scope', scope);
  return u.toString();
}

export function googleConnectUrl(state: string) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  u.searchParams.set('redirect_uri', googleRedirect());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

async function j<T = Record<string, unknown>>(res: Response): Promise<T & { error?: { message?: string } | string; error_description?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string; error_description?: string };
}
const errText = (x: { error?: { message?: string } | string; error_description?: string }, fallback: string) =>
  (typeof x.error === 'string' ? x.error_description || x.error : x.error?.message) || fallback;

// ---------- saving accounts ----------
async function saveAccount(orgId: string, userId: string, a: { platform: Platform; account_id: string; name: string; picture?: string | null; page_id?: string | null }, secret: { access_token: string; refresh_token?: string | null; expires_at?: string | null }) {
  const admin = createAdminClient()!;
  const { data, error } = await admin.from('social_accounts').upsert({ org_id: orgId, connected_by: userId, active: true, ...a }, { onConflict: 'org_id,platform,account_id' }).select('id').single();
  if (error || !data) throw new Error(error?.message || 'Could not save the account');
  const { error: e2 } = await admin.from('social_secrets').upsert({ account_id: data.id, ...secret }, { onConflict: 'account_id' });
  if (e2) throw new Error(e2.message);
  return data.id as string;
}

/** Facebook login finished: keep every Page the person manages, its Instagram account, and switch on lead forms. */
export async function finishMeta(orgId: string, userId: string, code: string): Promise<{ pages: number; instagram: number }> {
  const id = process.env.META_APP_ID!, secret = process.env.META_APP_SECRET!;
  const t1 = await j<{ access_token?: string }>(await fetch(`${GRAPH}/oauth/access_token?client_id=${id}&client_secret=${secret}&redirect_uri=${encodeURIComponent(metaRedirect())}&code=${encodeURIComponent(code)}`, { cache: 'no-store' }));
  if (!t1.access_token) throw new Error(errText(t1, 'Facebook did not give access'));
  // Long-lived user key → Page keys that do not expire
  const t2 = await j<{ access_token?: string }>(await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${id}&client_secret=${secret}&fb_exchange_token=${t1.access_token}`, { cache: 'no-store' }));
  const userToken = t2.access_token || t1.access_token;
  const pages = await j<{ data?: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[] }>(
    await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}&limit=50&access_token=${userToken}`, { cache: 'no-store' }));
  if (!pages.data) throw new Error(errText(pages, 'Could not read your Facebook Pages'));
  let ig = 0;
  for (const p of pages.data) {
    await saveAccount(orgId, userId, { platform: 'facebook', account_id: p.id, name: p.name, picture: p.picture?.data?.url ?? null }, { access_token: p.access_token });
    // Lead forms of this Page arrive in the CRM by themselves
    await fetch(`${GRAPH}/${p.id}/subscribed_apps?subscribed_fields=leadgen&access_token=${p.access_token}`, { method: 'POST', cache: 'no-store' }).catch(() => null);
    if (p.instagram_business_account) {
      ig++;
      await saveAccount(orgId, userId, { platform: 'instagram', account_id: p.instagram_business_account.id, name: '@' + (p.instagram_business_account.username || 'instagram'), picture: p.instagram_business_account.profile_picture_url ?? null, page_id: p.id }, { access_token: p.access_token });
    }
  }
  return { pages: pages.data.length, instagram: ig };
}

/** Google login finished: keep the YouTube channel. */
export async function finishGoogle(orgId: string, userId: string, code: string): Promise<string> {
  const t = await j<{ access_token?: string; refresh_token?: string; expires_in?: number }>(await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirect(), grant_type: 'authorization_code' }),
  }));
  if (!t.access_token) throw new Error(errText(t, 'Google did not give access'));
  const ch = await j<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }[] }>(
    await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` }, cache: 'no-store' }));
  const c = ch.items?.[0];
  if (!c) throw new Error('This Google account has no YouTube channel. Create the channel first, then connect again.');
  await saveAccount(orgId, userId, { platform: 'youtube', account_id: c.id, name: c.snippet.title, picture: c.snippet.thumbnails?.default?.url ?? null },
    { access_token: t.access_token, refresh_token: t.refresh_token ?? null, expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString() });
  return c.snippet.title;
}

async function googleToken(accountId: string): Promise<string> {
  const admin = createAdminClient()!;
  const { data: s } = await admin.from('social_secrets').select('access_token, refresh_token, expires_at').eq('account_id', accountId).maybeSingle();
  if (!s) throw new Error('YouTube is not connected. Connect it again.');
  if (s.expires_at && new Date(s.expires_at).getTime() - Date.now() > 120_000) return s.access_token;
  if (!s.refresh_token) throw new Error('YouTube access ended. Connect YouTube again.');
  const t = await j<{ access_token?: string; expires_in?: number }>(await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: s.refresh_token, grant_type: 'refresh_token' }),
  }));
  if (!t.access_token) throw new Error(errText(t, 'YouTube access ended. Connect YouTube again.'));
  await admin.from('social_secrets').update({ access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString() }).eq('account_id', accountId);
  return t.access_token;
}

// ---------- publishing ----------
async function post(url: string, params: Record<string, string>) {
  return j<{ id?: string; post_id?: string }>(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), cache: 'no-store', signal: AbortSignal.timeout(50_000) }));
}

async function toFacebook(pageId: string, token: string, caption: string, media: Media[]): Promise<Result> {
  const video = media.find((m) => m.type === 'video');
  if (video) {
    const r = await post(`${GRAPH_VIDEO}/${pageId}/videos`, { file_url: video.url, description: caption, access_token: token });
    if (!r.id) return { ok: false, error: errText(r, 'Facebook did not take the video') };
    return { ok: true, id: r.id, url: `https://www.facebook.com/${pageId}/videos/${r.id}` };
  }
  const imgs = media.filter((m) => m.type === 'image');
  if (imgs.length === 1) {
    const r = await post(`${GRAPH}/${pageId}/photos`, { url: imgs[0].url, caption, access_token: token });
    if (!r.id) return { ok: false, error: errText(r, 'Facebook did not take the photo') };
    return { ok: true, id: r.post_id || r.id, url: `https://www.facebook.com/${r.post_id || r.id}` };
  }
  const ids: string[] = [];
  for (const m of imgs) {
    const r = await post(`${GRAPH}/${pageId}/photos`, { url: m.url, published: 'false', access_token: token });
    if (!r.id) return { ok: false, error: errText(r, 'Facebook did not take a photo') };
    ids.push(r.id);
  }
  const params: Record<string, string> = { message: caption, access_token: token };
  ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const r = await post(`${GRAPH}/${pageId}/feed`, params);
  if (!r.id) return { ok: false, error: errText(r, 'Facebook did not publish the post') };
  return { ok: true, id: r.id, url: `https://www.facebook.com/${r.id}` };
}

/** Instagram: make the container (step 1). Videos then need a minute to process before they can be published. */
async function igContainer(igId: string, token: string, caption: string, media: Media[]): Promise<Result> {
  const items = media.slice(0, 10);
  if (items.length === 1) {
    const m = items[0];
    const r = await post(`${GRAPH}/${igId}/media`, m.type === 'video'
      ? { media_type: 'REELS', video_url: m.url, caption, share_to_feed: 'true', access_token: token }
      : { image_url: m.url, caption, access_token: token });
    return r.id ? { step: 'container', container: r.id } : { ok: false, error: errText(r, 'Instagram did not take the file') };
  }
  const children: string[] = [];
  for (const m of items) {
    const r = await post(`${GRAPH}/${igId}/media`, m.type === 'video'
      ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true', access_token: token }
      : { image_url: m.url, is_carousel_item: 'true', access_token: token });
    if (!r.id) return { ok: false, error: errText(r, 'Instagram did not take a file') };
    children.push(r.id);
  }
  const r = await post(`${GRAPH}/${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token });
  return r.id ? { step: 'container', container: r.id } : { ok: false, error: errText(r, 'Instagram did not take the post') };
}

/** Instagram step 2: publish when ready. Returns null while Instagram is still processing. */
async function igPublish(igId: string, token: string, container: string): Promise<Result | null> {
  const st = await j<{ status_code?: string; status?: string }>(await fetch(`${GRAPH}/${container}?fields=status_code,status&access_token=${token}`, { cache: 'no-store' }));
  if (st.status_code === 'IN_PROGRESS') return null;
  if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') return { ok: false, error: `Instagram could not process the file (${st.status || st.status_code}). Check the video is MP4 (H.264), 3 s – 15 min, and the photo is a JPG between square-ish and 4:5.` };
  const r = await post(`${GRAPH}/${igId}/media_publish`, { creation_id: container, access_token: token });
  if (!r.id) return { ok: false, error: errText(r, 'Instagram did not publish the post') };
  const link = await j<{ permalink?: string }>(await fetch(`${GRAPH}/${r.id}?fields=permalink&access_token=${token}`, { cache: 'no-store' }));
  return { ok: true, id: r.id, url: link.permalink || 'https://www.instagram.com/' };
}

async function toYouTube(accountId: string, title: string, caption: string, media: Media[]): Promise<Result> {
  const video = media.find((m) => m.type === 'video');
  if (!video) return { ok: false, error: 'YouTube needs a video.' };
  const token = await googleToken(accountId);
  const file = await fetch(video.url, { cache: 'no-store' });
  if (!file.ok) return { ok: false, error: 'Could not read the video file.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const vertical = video.h && video.w ? video.h > video.w : true;
  const meta = {
    snippet: { title: (title || caption.split('\n')[0] || 'New video').slice(0, 95) + (vertical && !/#shorts/i.test(title) ? ' #Shorts' : ''), description: caption.slice(0, 4900), categoryId: '22' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.headers.get('content-type') || 'video/mp4', 'X-Upload-Content-Length': String(bytes.length) },
    body: JSON.stringify(meta),
  });
  const loc = start.headers.get('location');
  if (!loc) return { ok: false, error: errText(await j(start), 'YouTube did not start the upload') };
  const up = await j<{ id?: string }>(await fetch(loc, { method: 'PUT', body: bytes, headers: { 'Content-Type': file.headers.get('content-type') || 'video/mp4' }, cache: 'no-store', signal: AbortSignal.timeout(55_000) }));
  if (!up.id) return { ok: false, error: errText(up, 'YouTube did not take the video') };
  return { ok: true, id: up.id, url: vertical ? `https://www.youtube.com/shorts/${up.id}` : `https://youtu.be/${up.id}` };
}

/** Publishes (or continues publishing) one post. Safe to call many times: finished platforms are skipped. */
export async function runPost(postId: string, waitMs = 35_000): Promise<{ status: string; results: Record<string, Result> }> {
  const admin = createAdminClient();
  if (!admin) throw new Error('The server key is missing in Vercel (SUPABASE_SERVICE_ROLE_KEY).');
  const lockBefore = new Date(Date.now() - 90_000).toISOString();
  const { data: claimed } = await admin.from('social_posts').update({ locked_at: new Date().toISOString(), status: 'publishing' })
    .eq('id', postId).in('status', ['scheduled', 'publishing', 'failed', 'partial', 'draft']).or(`locked_at.is.null,locked_at.lt.${lockBefore}`).select('*');
  const p = claimed?.[0];
  if (!p) { const { data } = await admin.from('social_posts').select('status, results').eq('id', postId).maybeSingle(); return { status: data?.status ?? 'missing', results: (data?.results ?? {}) as Record<string, Result> }; }

  const results: Record<string, Result> = { ...(p.results as Record<string, Result>) };
  const media = (p.media ?? []) as Media[];
  const { data: accounts } = await admin.from('social_accounts').select('id, platform, account_id, name, active').in('id', p.targets ?? []);
  const { data: secrets } = await admin.from('social_secrets').select('account_id, access_token').in('account_id', p.targets ?? []);
  const keyOf = (id: string) => secrets?.find((s) => s.account_id === id)?.access_token ?? '';
  const save = async (extra: Record<string, unknown> = {}) => { await admin.from('social_posts').update({ results, ...extra }).eq('id', postId); };

  for (const a of accounts ?? []) {
    if (results[a.id]?.ok) continue;
    if (results[a.id]?.step === 'container') continue; // Instagram: waiting below
    try {
      if (a.platform === 'facebook') results[a.id] = await toFacebook(a.account_id, keyOf(a.id), p.caption, media);
      else if (a.platform === 'instagram') results[a.id] = await igContainer(a.account_id, keyOf(a.id), p.caption, media);
      else if (a.platform === 'youtube') results[a.id] = await toYouTube(a.id, p.title ?? '', p.caption, media);
    } catch (e) { results[a.id] = { ok: false, error: (e as Error).message || 'Failed' }; }
    results[a.id].at = new Date().toISOString();
    await save();
  }
  // Instagram containers: wait a little for processing, then publish.
  const until = Date.now() + waitMs;
  for (;;) {
    const waiting = (accounts ?? []).filter((a) => results[a.id]?.step === 'container');
    if (!waiting.length) break;
    for (const a of waiting) {
      const r = await igPublish(a.account_id, keyOf(a.id), results[a.id].container!).catch((e) => ({ ok: false, error: (e as Error).message }) as Result);
      if (r) { results[a.id] = { ...r, at: new Date().toISOString() }; await save(); }
    }
    if (!(accounts ?? []).some((a) => results[a.id]?.step === 'container') || Date.now() > until) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  const vals = (accounts ?? []).map((a) => results[a.id]);
  const pending = vals.some((r) => r?.step === 'container');
  const okN = vals.filter((r) => r?.ok).length;
  const status = pending ? 'publishing' : okN === vals.length && okN > 0 ? 'done' : okN > 0 ? 'partial' : 'failed';
  await save({ status, locked_at: null, ...(okN && !p.published_at ? { published_at: new Date().toISOString() } : {}) });
  return { status, results };
}

/** Scheduled posts that are due, and Instagram videos still processing. */
export async function runDuePosts(orgId?: string, budgetMs = 45_000) {
  const admin = createAdminClient();
  if (!admin) return { ran: 0 };
  let q = admin.from('social_posts').select('id').or(`and(status.eq.scheduled,scheduled_at.lte.${new Date().toISOString()}),status.eq.publishing`).order('scheduled_at', { ascending: true }).limit(10);
  if (orgId) q = q.eq('org_id', orgId);
  const { data } = await q;
  const end = Date.now() + budgetMs;
  let ran = 0;
  for (const p of data ?? []) {
    if (Date.now() > end) break;
    await runPost(p.id, Math.min(20_000, Math.max(0, end - Date.now() - 10_000))).catch(() => null);
    ran++;
  }
  return { ran };
}

// ---------- Meta lead ads ----------
export function checkMetaSignature(raw: string, header: string | null) {
  if (!header || !process.env.META_APP_SECRET) return false;
  const want = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
  return want.length === header.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(header));
}

/** Reads one lead form submission with the Page key. */
export async function readMetaLead(pageId: string, leadgenId: string) {
  const admin = createAdminClient()!;
  const { data: acc } = await admin.from('social_accounts').select('id, org_id').eq('platform', 'facebook').eq('account_id', pageId).eq('active', true).limit(1).maybeSingle();
  if (!acc) return null;
  const { data: s } = await admin.from('social_secrets').select('access_token').eq('account_id', acc.id).maybeSingle();
  if (!s) return null;
  const lead = await j<{ field_data?: { name: string; values: string[] }[]; created_time?: string; ad_name?: string; campaign_name?: string; form_id?: string; platform?: string }>(
    await fetch(`${GRAPH}/${leadgenId}?fields=field_data,created_time,ad_name,campaign_name,form_id,platform&access_token=${s.access_token}`, { cache: 'no-store' }));
  if (!lead.field_data) return null;
  return { orgId: acc.org_id as string, lead };
}
