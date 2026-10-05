'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { addProjectPhotos, removeProjectPhoto, setCoverPhoto } from '@/app/crm-actions';

/** Makes big phone photos small before upload (max 1800 px wide, JPEG). */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read photo'))), 'image/jpeg', 0.82));
}

export function ProjectPhotos({ projectId, orgId, name, photos, canEdit }: { projectId: string; orgId: string; name: string; photos: string[]; canEdit: boolean }) {
  const router = useRouter();
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
    if (urls.length) { const r = await addProjectPhotos(projectId, urls); if (r.error) setError(r.error); }
    setBusy('');
    router.refresh();
  }

  async function act(fn: () => Promise<{ error?: string }>) {
    setBusy('Saving…');
    const r = await fn();
    setBusy('');
    if (r.error) setError(r.error); else { close(); router.refresh(); }
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
            {canEdit && open > 0 && <button className="btn sm" disabled={!!busy} onClick={() => act(() => setCoverPhoto(projectId, photos[open]))}>Make cover</button>}
            {canEdit && <button className="btn sm danger" disabled={!!busy} onClick={() => { if (confirm('Remove this photo?')) act(() => removeProjectPhoto(projectId, photos[open])); }}>Remove</button>}
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
