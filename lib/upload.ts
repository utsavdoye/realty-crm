'use client';

import { createClient } from '@/lib/supabase/client';

/** Makes big phone photos small before upload (JPEG). Floor plans keep more detail. */
export async function shrink(file: File, max = 1800, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // plans drawn on transparent PNGs stay readable
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the picture'))), 'image/jpeg', quality));
}

const rand = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Uploads one file into the project's folder and returns its public link. */
export async function uploadProjectFile(orgId: string, projectId: string, kind: 'photo' | 'plan' | 'brochure', file: File): Promise<string> {
  const supabase = createClient();
  let blob: Blob = file; let ext = 'jpg'; let type = 'image/jpeg';
  if (kind === 'brochure') {
    if (file.type !== 'application/pdf') throw new Error('Pick a PDF file');
    if (file.size > 20 * 1024 * 1024) throw new Error('The PDF is bigger than 20 MB');
    ext = 'pdf'; type = 'application/pdf';
  } else {
    blob = await shrink(file, kind === 'plan' ? 2400 : 1800, kind === 'plan' ? 0.9 : 0.82);
  }
  const folder = kind === 'photo' ? '' : kind === 'plan' ? 'plans/' : 'docs/';
  const path = `${orgId}/${projectId}/${folder}${rand()}.${ext}`;
  const { error } = await supabase.storage.from('project-photos').upload(path, blob, { contentType: type, cacheControl: '31536000' });
  if (error) throw new Error(/mime|type/i.test(error.message) ? 'Run patch-013 in Supabase first.' : error.message);
  return supabase.storage.from('project-photos').getPublicUrl(path).data.publicUrl;
}
