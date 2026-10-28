import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { googleConnectUrl, googleReady, makeState } from '@/lib/social';

export const dynamic = 'force-dynamic';

/** "Connect YouTube" → Google's login page. */
export async function GET() {
  const { org, user } = await requireOrg(['owner', 'manager']);
  if (!googleReady()) redirect('/posts?error=' + encodeURIComponent('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first (see the steps on this page).'));
  redirect(googleConnectUrl(makeState(org.id, user.id)));
}
