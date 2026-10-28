import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { finishGoogle, readState } from '@/lib/social';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const { org, user } = await requireOrg(['owner', 'manager']);
  const s = readState(q.get('state') ?? '');
  if (q.get('error')) redirect('/posts?error=' + encodeURIComponent('YouTube connection was cancelled.'));
  if (!s || s.o !== org.id || s.u !== user.id || !q.get('code')) redirect('/posts?error=' + encodeURIComponent('This link expired. Press Connect again.'));
  let name = '';
  try { name = await finishGoogle(org.id, user.id, q.get('code')!); } catch (e) {
    redirect('/posts?error=' + encodeURIComponent((e as Error).message || 'Could not connect YouTube.'));
  }
  redirect('/posts?ok=' + encodeURIComponent(`YouTube channel "${name}" connected.`));
}
