import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/join', '/blocked', '/auth', '/api/hooks', '/api/leads', '/api/cron', '/p', '/s', '/r', '/forgot'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refreshes the login session on every request. Do not remove.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  // Signed in with a code but no password yet → choose one first (not needed for public pages and APIs).
  if (user && !user.user_metadata?.pw_set && !path.startsWith('/auth') && !path.startsWith('/api') && !['/p', '/s', '/r', '/forgot'].some((p) => path.startsWith(p + '/') || path === p)) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/set-password';
    url.search = '';
    url.searchParams.set('next', path === '/login' ? '/dashboard' : path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (path !== '/') url.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|glb)$).*)'],
};
