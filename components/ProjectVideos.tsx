'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addProjectVideo, removeProjectVideo, type ProjectVideo } from '@/app/crm-actions';
import { uploadProjectFile } from '@/lib/upload';

const MAX = 5;
const LIMIT = 10 * 1024 * 1024;
const mb = (b: number) => `${(Math.max(0, b) / 1024 / 1024).toFixed(1)} MB`;

/** Project videos: optional, up to 5, 10 MB in total. They show on the client website. */
export function ProjectVideos({ projectId, orgId, videos: fromServer, canEdit }: { projectId: string; orgId: string; videos: ProjectVideo[]; canEdit: boolean }) {
  const router = useRouter();
  const [videos, setVideos] = useState(fromServer);
  const key = fromServer.map((v) => v.url).join('|');
  useEffect(() => { setVideos(fromServer); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [play, setPlay] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const used = videos.reduce((a, v) => a + (Number(v.size) || 0), 0);

  if (!canEdit && !videos.length) return null;

  async function add(files: FileList) {
    setError('');
    let left = LIMIT - used, room = MAX - videos.length;
    for (const f of Array.from(files)) {
      if (room <= 0) { setError('A project can have up to 5 videos.'); break; }
      if (!/^video\//.test(f.type) && !/\.(mp4|mov|webm)$/i.test(f.name)) { setError(`${f.name} is not a video.`); continue; }
      if (f.size > left) { setError(`${f.name} is ${mb(f.size)}. Only ${mb(left)} is left (10 MB in total). Make the video shorter or smaller, then try again.`); continue; }
      setBusy(`Uploading ${f.name}…`);
      try {
        const url = await uploadProjectFile(orgId, projectId, 'video', f);
        const r = await addProjectVideo(projectId, { url, size: f.size, name: f.name });
        if (r.error) { setError(r.error); continue; }
        if (r.videos) setVideos(r.videos);
        left -= f.size; room--;
      } catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : 'could not upload'}`); }
    }
    setBusy('');
    router.refresh();
  }

  async function remove(url: string) {
    const before = videos;
    setVideos(videos.filter((v) => v.url !== url));
    const r = await removeProjectVideo(projectId, url).catch(() => ({ error: 'Could not remove. Check your internet.' }));
    if (r.error) { setVideos(before); setError(r.error); }
  }

  return (
    <div className="pvideos">
      <div className="pvideos-h">
        <b>Videos</b>
        <span className="hint">{videos.length ? `${videos.length} of ${MAX} · ${mb(used)} of 10 MB` : 'Optional · up to 5 videos, 10 MB in total'}</span>
      </div>
      {videos.length > 0 && (
        <div className="pvideos-list">
          {videos.map((v) => (
            <div key={v.url} className="pvideo">
              <button type="button" className="pvideo-thumb" onClick={() => setPlay(v.url)} aria-label={`Play ${v.name}`}>
                <video src={`${v.url}#t=0.5`} preload="metadata" muted playsInline />
                <span className="pvideo-play" aria-hidden="true">▶</span>
              </button>
              <span className="pvideo-name" title={v.name}>{v.name}</span>
              <span className="hint">{mb(v.size)}</span>
              {canEdit && <button type="button" className="btn sm ghost" onClick={() => remove(v.url)}>Remove</button>}
            </div>
          ))}
        </div>
      )}
      {canEdit && videos.length < MAX && (
        <label className={`btn sm ${busy ? 'disabled' : ''}`}>
          {busy || '+ Add video'}
          <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm" multiple hidden disabled={!!busy}
            onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
        </label>
      )}
      {error && <p className="msg err">{error}</p>}
      {play && (
        <div className="pop-back" role="dialog" aria-modal="true" aria-label="Video" onClick={() => setPlay(null)}>
          <div className="pvideo-pop" onClick={(e) => e.stopPropagation()}>
            <video src={play} controls autoPlay playsInline />
            <button type="button" className="btn sm" onClick={() => setPlay(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
