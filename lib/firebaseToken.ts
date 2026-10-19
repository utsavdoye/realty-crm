import 'server-only';
import crypto from 'crypto';

// Checks a Firebase ID token (from the website's SMS sign-in) without any extra package.
// Google signs these tokens; we check the signature with Google's public keys, then the project, time and number.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
type Jwk = crypto.JsonWebKey & { kid?: string };
let cache: { keys: Jwk[]; until: number } | null = null;

async function keys(): Promise<Jwk[]> {
  if (cache && cache.until > Date.now()) return cache.keys;
  const res = await fetch(process.env.FIREBASE_JWKS_URL || JWKS_URL, { cache: 'no-store' }); // override only for local tests
  if (!res.ok) throw new Error('Could not load Google keys');
  const body = (await res.json()) as { keys: Jwk[] };
  const age = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  cache = { keys: body.keys, until: Date.now() + Math.min(age, 6 * 3600) * 1000 };
  return body.keys;
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export type FirebaseClaims = { uid: string; name?: string; email?: string; email_verified?: boolean; phone_number?: string; sign_in_provider?: string };

/** Checks the token and returns who signed in, or null if it is not valid. */
export async function verifyFirebaseToken(idToken: string): Promise<FirebaseClaims | null> {
  const project = process.env.FIREBASE_PROJECT_ID;
  if (!project || typeof idToken !== 'string' || idToken.length > 4000) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
    const p = JSON.parse(b64(parts[1]).toString('utf8')) as { aud?: string; iss?: string; exp?: number; iat?: number; auth_time?: number; sub: string; phone_number?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    const jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const ok = crypto.createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64(parts[2]));
    const now = Math.floor(Date.now() / 1000);
    if (!ok || p.aud !== project || p.iss !== `https://securetoken.google.com/${project}` || !p.sub
      || !p.exp || p.exp < now - 60 || !p.iat || p.iat > now + 300 || (p.auth_time ?? 0) > now + 300) return null;
    const q = p as typeof p & { name?: string; email?: string; email_verified?: boolean; firebase?: { sign_in_provider?: string } };
    return {
      uid: p.sub, name: typeof q.name === 'string' ? q.name : undefined,
      email: typeof q.email === 'string' ? q.email : undefined, email_verified: q.email_verified === true,
      phone_number: typeof p.phone_number === 'string' && /^\+[1-9]\d{7,14}$/.test(p.phone_number) ? p.phone_number : undefined,
      sign_in_provider: q.firebase?.sign_in_provider,
    };
  } catch {
    return null;
  }
}

/** Returns the verified phone number (e.g. +919876543210), or null if the token is not valid. */
export async function verifiedPhoneFromFirebase(idToken: string): Promise<string | null> {
  return (await verifyFirebaseToken(idToken))?.phone_number ?? null;
}

export const firebaseReady = () => Boolean(process.env.FIREBASE_PROJECT_ID);
