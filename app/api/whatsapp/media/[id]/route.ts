import { createClient } from '@/lib/supabase/server';
import { downloadMedia } from '@/lib/whatsapp';

// Shows a photo / voice note / file a client sent. Only to people allowed to see that chat.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new Response('Not found', { status: 404 });
  const { data: m } = await supabase.from('wa_messages').select('media_id, media_mime, file_name').eq('id', params.id).maybeSingle();
  if (!m?.media_id) return new Response('Not found', { status: 404 });
  const file = await downloadMedia(m.media_id);
  if (!file) return new Response('WhatsApp no longer has this file (they keep them for 30 days).', { status: 410 });
  const name = (m.file_name || 'file').replace(/[^\w.\- ]/g, '_');
  return new Response(file.body, { headers: { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${name}"` } });
}
