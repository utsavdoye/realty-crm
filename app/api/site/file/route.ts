import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase/admin';
import { readFileLink } from '@/lib/fileLink';

// A brochure or floor-plan PDF with the company's contact details on every page:
// a box on the first page and a line at the bottom of each page. Works for every PDF, old or new.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const f = readFileLink(q.get('d') ?? '', q.get('s') ?? '');
  if (!f) return new Response('This link has expired. Please open the brochure again from the website.', { status: 403 });

  // contact details of the company
  const admin = createAdminClient();
  const { data: org } = admin ? await admin.from('organizations').select('name, website_phone, website_url').eq('id', f.o).maybeSingle() : { data: null };
  const o = (org ?? {}) as { name?: string; website_phone?: string | null; website_url?: string | null };
  const name = clean(o.name || '');
  const phone = clean(o.website_phone || '');
  const web = clean((o.website_url || '').replace(/^https?:\/\//, ''));
  const line = [name, phone ? 'Call ' + phone : '', web].filter(Boolean).join('   |   ');

  let bytes: ArrayBuffer;
  try {
    const r = await fetch(f.u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(String(r.status));
    bytes = await r.arrayBuffer();
  } catch { return Response.redirect(f.u, 302); }
  if (!line) return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=600' } });

  let out: Uint8Array;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const gold = rgb(0.69, 0.53, 0.29), ink = rgb(0.13, 0.12, 0.11);
    pdf.getPages().forEach((page, i) => {
      const { width } = page.getSize();
      // bottom line on every page
      let size = Math.max(6, Math.min(10, width / 70));
      while (size > 6 && font.widthOfTextAtSize(line, size) > width - 40) size -= 0.5;
      const h = size + 10;
      page.drawRectangle({ x: 0, y: 0, width, height: h, color: rgb(1, 1, 1), opacity: 0.92 });
      page.drawRectangle({ x: 0, y: h, width, height: 0.8, color: gold });
      page.drawText(line, { x: (width - font.widthOfTextAtSize(line, size)) / 2, y: 5, size, font, color: ink });
      // contact box on the first page
      if (i === 0) {
        const title = name || 'Contact us', sub = [phone ? 'Call ' + phone : '', web].filter(Boolean).join('  |  ');
        const ts = Math.max(9, Math.min(15, width / 40)), ss = ts * 0.72;
        const bw = Math.min(width - 24, Math.max(bold.widthOfTextAtSize(title, ts), font.widthOfTextAtSize(sub, ss)) + 28), bh = ts + ss + 22;
        const { height } = page.getSize();
        const x = width - bw - 12, y = height - bh - 12;
        page.drawRectangle({ x, y, width: bw, height: bh, color: rgb(1, 1, 1), opacity: 0.95, borderColor: gold, borderWidth: 1 });
        page.drawText(title, { x: x + 14, y: y + bh - ts - 8, size: ts, font: bold, color: ink });
        if (sub) page.drawText(sub, { x: x + 14, y: y + 9, size: ss, font, color: ink });
      }
    });
    out = await pdf.save();
  } catch { return Response.redirect(f.u, 302); }   // a PDF we cannot edit opens as it is
  const fname = (clean(f.n) || 'brochure').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') + '.pdf';
  return new Response(out, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fname}"`, 'Cache-Control': 'private, max-age=600' } });
}
