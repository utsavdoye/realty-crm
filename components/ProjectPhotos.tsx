'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { addProjectPhotos, removeProjectPhoto, setCoverPhoto } from '@/app/crm-actions';
import { shrink } from '@/lib/upload';

export function ProjectPhotos({ projectId, orgId, name, photos: fromServer, canEdit }: { projectId: string; orgId: string; name: string; photos: string[]; canEdit: boolean }) {
  const router = useRouter();
  // The list shown here changes at once when you remove a photo or pick a cover; the save runs in the background.
  const [photos, setPhotos] = useState(fromServer);
  const pending = useRef(0);
  const key = fromServer.join('|');
  useEffect(() => { if (!pending.current) setPhotos(fromServer); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(null), []);
  const move = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + photos.length) % photos.length)), [photos.length]);
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, close, move]);

  async function upload(files: FileList) {
    setError('');
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 20 - photos.length);
    if (!list.length) return setError(photos.length >= 20 ? 'A project can have up to 20 photos.' : 'Pick photo files (JPG or PNG).');
    const supabase = createClient();
    const urls: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const blob = await shrink(list[i]);
        const path = `${orgId}/${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error } = await supabase.storage.from('project-photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error) throw error;
        urls.push(supabase.storage.from('project-photos').getPublicUrl(path).data.publicUrl);
      } catch (e) {
        setError(`Could not upload ${list[i].name}. ${e instanceof Error && e.message.includes('Bucket') ? 'Run patch-006 in Supabase first.' : ''}`);
      }
    }
    if (urls.length) {
      setPhotos((p) => [...p, ...urls].slice(0, 20));
      pending.current++;
      const r = await addProjectPhotos(projectId, urls).finally(() => { pending.current--; });
      if (r.error) setError(r.error);
    }
    setBusy('');
    router.refresh();
  }

  async function quick(next: string[], save: () => Promise<{ error?: string }>) {
    const before = photos;
    setError('');
    setPhotos(next);
    pending.current++;
    try {
      const r = await save();
      if (r.error) { setPhotos(before); setError(r.error); }
    } catch { setPhotos(before); setError('Could not save. Check your internet and try again.'); }
    finally { pending.current--; }
  }

  function removeAt(i: number) {
    const url = photos[i];
    const next = photos.filter((u) => u !== url);
    setOpen(next.length ? Math.min(i, next.length - 1) : null);
    quick(next, () => removeProjectPhoto(projectId, url));
  }

  function makeCover(i: number) {
    const url = photos[i];
    setOpen(0);
    quick([url, ...photos.filter((u) => u !== url)], () => setCoverPhoto(projectId, url));
  }

  return (
    <div className="pphotos">
      {photos.length ? (
        <button type="button" className="pcover" onClick={() => setOpen(0)} aria-label={`See ${photos.length} photos of ${name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0]} alt={name} loading="lazy" />
          {photos.length > 1 && <span className="pcount">1 / {photos.length}</span>}
        </button>
      ) : (
        <div className="pcover empty-photo"><span>No photos yet</span></div>
      )}
      {photos.length > 1 && (
        <div className="pthumbs">
          {photos.slice(1, 5).map((p, i) => (
            <button key={p} type="button" onClick={() => setOpen(i + 1)} aria-label={`Photo ${i + 2}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" loading="lazy" />
              {i === 3 && photos.length > 5 && <span>+{photos.length - 5}</span>}
            </button>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="row-gap">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
          <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => input.current?.click()}>{busy || '+ Add photos'}</button>
        </div>
      )}
      {error && <p className="msg err">{error}</p>}

      {open != null && photos[open] && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} photos`} onClick={close}>
          <div className="lb-top" onClick={(e) => e.stopPropagation()}>
            <b>{name}</b><span className="hint">{open + 1} / {photos.length}</span>
            {canEdit && open > 0 && <button className="btn sm" disabled={!!busy} onClick={() => makeCover(open)}>Make cover</button>}
            {canEdit && <button className="btn sm danger" disabled={!!busy} onClick={() => { if (confirm('Remove this photo?')) removeAt(open); }}>Remove</button>}
            <button className="btn sm" onClick={close} aria-label="Close">✕</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[open]} alt={`${name} photo ${open + 1}`} onClick={(e) => e.stopPropagation()} />
          {photos.length > 1 && <>
            <button className="lb-nav prev" onClick={(e) => { e.stopPropagation(); move(-1); }} aria-label="Previous photo">‹</button>
            <button className="lb-nav next" onClick={(e) => { e.stopPropagation(); move(1); }} aria-label="Next photo">›</button>
          </>}
        </div>
      )}
    </div>
  );
}
