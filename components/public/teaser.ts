import type { PubProject } from '@/components/public/ProjectBlock';

/** What the client sees before unlocking: 1 photo, starting price, no brochure. Everything else stays on the server. */
export type Teaser = Omit<PubProject, 'photos' | 'price_to' | 'link'> & { cover: string | null; more: number; hasRange: boolean; hasBrochure: boolean };

/** Shapes full project data into a teaser. Call this on the server so hidden details never reach the browser. */
export function toTeaser(p: PubProject): Teaser {
  const rest: Record<string, unknown> = { ...p };
  delete rest.photos; delete rest.price_to; delete rest.link;
  return { ...(rest as Omit<PubProject, 'photos' | 'price_to' | 'link'>), cover: p.photos?.[0] ?? null, more: Math.max(0, (p.photos?.length ?? 0) - 1), hasRange: p.price_to != null, hasBrochure: !!p.link };
}
