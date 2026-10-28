'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { aiCaption, createPost, runDueNow } from '@/app/social-actions';

export type Account = { id: string; platform: 'facebook' | 'instagram' | 'youtube'; name: string | null; picture: string | null; active: boolean };
type Item = { file: File; preview: string; type: 'image' | 'video'; url?: string; size?: number; w?: number; h?: number; state: 'ready' | 'uploading' | 'done' | 'error'; error?: string };

const PLATFORM: Record<Account['platform'], string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube' };
const MAX_VIDEO = 50 * 1024 * 1024;
const rand = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Photos become JPG (Instagram only takes JPG) and are padded to a shape Instagram accepts (4:5 to 1.91:1). */
async function preparePhoto(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2160 / Math.max(bmp.width, bmp.height));
  let w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  let cw = w, ch = h;
  if (w / h < 0.8) cw = Math.round(h * 0.8);        // too tall → add sides
  else if (w / h > 1.91) ch = Math.round(w / 1.91);  // too wide → add top/bottom
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch);
  g.drawImage(bmp, Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the photo'))), 'image/jpeg', 0.9));
  [w, h] = [cw, ch];
  return { blob, w, h };
}

function videoSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const v = document.createElement('video'); v.preload = 'metadata';
    v.onloadedmetadata = () => { res({ w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(v.src); };
    v.onerror = () => res({ w: 0, h: 0 });
    v.src = URL.createObjectURL(file);
  });
}

export function PostComposer({ orgId, accounts, projects, aiOn }: { orgId: string; accounts: Account[]; projects: string[]; aiOn: boolean }) {
  const router = useRouter();
  const live = accounts.filter((a) => a.active);
  const [items, setItems] = useState<Item[]>([]);
  const [caption, setCaption] = useState('');
  const [title, setTitle] = useState('');
  const [targets, setTargets] = useState<string[]>(live.map((a) => a.id));
  const [when, setWhen] = useState<'now' | 'schedule'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [about, setAbout] = useState('');
  const [project, setProject] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const hasVideo = items.some((i) => i.type === 'video');
  const usable = useMemo(() => live.filter((a) => a.platform !== 'youtube' || hasVideo), [live, hasVideo]);
  useEffect(() => { setTargets((t) => t.filter((id) => usable.some((a) => a.id === id))); }, [usable]);

  // While this page is open: publish scheduled posts that are due, finish Instagram videos.
  useEffect(() => {
    const tick = () => runDueNow().then((r) => { if (r.ran) router.refresh(); }).catch(() => {});
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [router]);

  function add(files: FileList | null) {
    setMsg(null);
    const list = Array.from(files ?? []);
    const vids = list.filter((f) => f.type.startsWith('video/'));
    const imgs = list.filter((f) => f.type.startsWith('image/'));
    if (vids.length && (vids.length > 1 || imgs.length || items.length)) return setMsg({ error: 'A post can have one video, or up to 10 photos (not both).' });
    if (hasVideo && imgs.length) return setMsg({ error: 'This post already has a video. Remove it to add photos.' });
    const big = vids.find((v) => v.size > MAX_VIDEO);
    if (big) return setMsg({ error: `The video is ${(big.size / 1048576).toFixed(0)} MB. The limit is 50 MB: export it at 1080p (WhatsApp-quality also works).` });
    const next = [...vids, ...imgs].slice(0, 10 - items.length).map<Item>((file) => ({ file, preview: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image', state: 'ready' }));
    setItems((x) => [...x, ...next]);
  }

  async function upload(list: Item[]): Promise<Item[] | null> {
    const supabase = createClient();
    const out: Item[] = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.url) { out.push(it); continue; }
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      try {
        let blob: Blob = it.file, ext = 'jpg', type = 'image/jpeg', w = 0, h = 0;
        if (it.type === 'image') ({ blob, w, h } = await preparePhoto(it.file));
        else { ({ w, h } = await videoSize(it.file)); type = it.file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4'; ext = type === 'video/quicktime' ? 'mov' : 'mp4'; }
        const path = `${orgId}/posts/${rand()}.${ext}`;
        const { error } = await supabase.storage.from('project-photos').upload(path, blob, { contentType: type, cacheControl: '31536000' });
        if (error) throw new Error(/size|exceed/i.test(error.message) ? 'File is too big (run patch-039 for 50 MB uploads).' : /mime|type/i.test(error.message) ? 'Run patch-036 in Supabase first (videos).' : error.message);
        out.push({ ...it, url: supabase.storage.from('project-photos').getPublicUrl(path).data.publicUrl, size: blob.size, w, h, state: 'done' });
      } catch (e) {
        setItems((x) => x.map((y) => (y === it ? { ...y, state: 'error', error: (e as Error).message } : y)));
        setBusy(''); setMsg({ error: `${it.file.name}: ${(e as Error).message}` });
        return null;
      }
    }
    setItems(out);
    return out;
  }

  async function writeWithAi() {
    if (!about.trim() && !project) return setMsg({ error: 'Tell the AI what the post is about (or pick a project).' });
    setBusy('Writing…'); setMsg(null);
    const r = await aiCaption(about, project, 'premium, warm, trustworthy').catch(() => ({ error: 'AI could not write it right now.' }));
    setBusy('');
    if ('caption' in r && r.caption) { setCaption(r.caption); if (r.title) setTitle(r.title); } else setMsg({ error: r.error || 'AI could not write it.' });
  }

  async function submit(mode: 'now' | 'schedule' | 'draft') {
    setMsg(null);
    if (!items.length) return setMsg({ error: 'Add a photo or a video.' });
    if (mode !== 'draft' && !targets.length) return setMsg({ error: 'Choose where to post.' });
    if (mode === 'schedule' && !at) return setMsg({ error: 'Pick the date and time.' });
    const up = await upload(items);
    if (!up) return;
    setBusy(mode === 'now' ? 'Posting… (videos can take a minute)' : 'Saving…');
    const r = await createPost({
      caption, title, targets, mode, scheduledAt: mode === 'schedule' ? new Date(at).toISOString() : undefined,
      media: up.map((u) => ({ url: u.url!, type: u.type, size: u.size, w: u.w, h: u.h })),
    }).catch(() => ({ error: 'Could not reach the server. Check your internet.' }));
    setBusy(''); setMsg(r);
    if (!r.error || ('id' in r && r.id)) { setItems([]); setCaption(''); setTitle(''); setAbout(''); }
    router.refresh();
  }

  if (!accounts.length) return null;
  const igRatioWarn = items.some((i) => i.type === 'video') && targets.some((id) => live.find((a) => a.id === id)?.platform === 'instagram');

  return (
    <div className="composer stack">
      <div className="composer-media">
        {items.map((it, i) => (
          <div key={it.preview} className={`cm-item ${it.state}`}>
            {it.type === 'video' ? <video src={it.preview} muted playsInline /> : <img src={it.preview} alt="" /> /* eslint-disable-line @next/next/no-img-element */}
            {i === 0 && items.length > 1 && <i>1st</i>}
            <button type="button" aria-label="Remove" onClick={() => setItems((x) => x.filter((y) => y !== it))} disabled={!!busy}>✕</button>
          </div>
        ))}
        {(!hasVideo && items.length < 10) && (
          <button type="button" className="cm-add" onClick={() => fileInput.current?.click()} disabled={!!busy}>
            <b>+</b><span>{items.length ? 'Add more photos' : 'Add photos or a video'}</span>
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      <p className="hint">Up to 10 photos (they are posted as one swipe post) or 1 video up to 50 MB. Vertical videos (9:16) work best: Reels and YouTube Shorts.</p>

      {aiOn && (
        <div className="composer-ai">
          <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What is this post about? e.g. Diwali offer site visits, new tower launched, sample flat ready" maxLength={600} />
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project"><option value="">No project</option>{projects.map((p) => <option key={p}>{p}</option>)}</select>
          <button type="button" className="btn sm" onClick={writeWithAi} disabled={!!busy}>{busy === 'Writing…' ? 'Writing…' : '✦ Write with AI'}</button>
        </div>
      )}

      <label className="field"><span className="label row-between">Caption <span className="hint">{caption.length} / 2200</span></span>
        <textarea rows={6} value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="Write the post. Add a call to action like “DM us or call to book a site visit” and a few hashtags." /></label>

      {hasVideo && targets.some((id) => live.find((a) => a.id === id)?.platform === 'youtube') && (
        <label className="field"><span className="label">YouTube title</span><input value={title} maxLength={95} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 3 BHK sample flat tour – Atal Nagar, Raipur" /></label>
      )}

      <div className="field"><span className="label">Post to</span>
        <div className="composer-targets">
          {live.map((a) => {
            const off = a.platform === 'youtube' && !hasVideo;
            return (
              <label key={a.id} className={`ct ${off ? 'off' : ''}`} title={off ? 'YouTube needs a video' : ''}>
                <input type="checkbox" disabled={off} checked={targets.includes(a.id)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, a.id] : t.filter((x) => x !== a.id)))} />
                <span className={`pf pf-${a.platform}`}>{PLATFORM[a.platform]}</span>
                <span className="ct-name">{a.name}</span>
              </label>
            );
          })}
        </div>
        {igRatioWarn && <span className="hint">Instagram Reels: MP4, 3 seconds to 15 minutes, vertical looks best.</span>}
      </div>

      <div className="composer-when">
        <label className="check"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Post now</label>
        <label className="check"><input type="radio" checked={when === 'schedule'} onChange={() => setWhen('schedule')} /> Schedule</label>
        {when === 'schedule' && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} min={new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} />}
      </div>

      {msg?.ok && <p className="msg ok">{msg.ok}</p>}
      {msg?.error && <p className="msg err">{msg.error}</p>}
      <div className="row-btns">
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => submit(when)}>{busy && busy !== 'Writing…' ? busy : when === 'now' ? 'Publish now' : 'Schedule post'}</button>
        <button type="button" className="btn ghost" disabled={!!busy} onClick={() => submit('draft')}>Save draft</button>
      </div>
    </div>
  );
}
