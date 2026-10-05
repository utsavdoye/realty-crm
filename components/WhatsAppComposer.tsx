'use client';

import { useMemo, useState } from 'react';
import { logWhatsApp } from '@/app/crm-actions';
import { fillTemplate, waLink, type TemplateContext } from '@/lib/crm';

type T = { id: string; name: string; use_for: string; body: string };

export function WhatsAppComposer({ leadId, phone, templates, ctx, defaultUse }: { leadId: string; phone: string; templates: T[]; ctx: TemplateContext; defaultUse?: string }) {
  const first = templates.find((t) => t.use_for === defaultUse) ?? templates[0];
  const [tid, setTid] = useState(first?.id ?? '');
  const [text, setText] = useState(first ? fillTemplate(first.body, ctx) : `Hi ${(ctx.name || '').split(' ')[0]}, `);
  const tpl = useMemo(() => templates.find((t) => t.id === tid), [templates, tid]);
  return (
    <div className="stack">
      {templates.length > 0 && (
        <select aria-label="Message template" value={tid} onChange={(e) => { setTid(e.target.value); const t = templates.find((x) => x.id === e.target.value); setText(t ? fillTemplate(t.body, ctx) : ''); }}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.use_for}: {t.name}</option>)}
          <option value="">Blank message</option>
        </select>
      )}
      <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
      <div className="row-gap">
        <a className="btn wa" href={waLink(phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => { logWhatsApp(leadId, tpl?.name ?? ''); }}>Open in WhatsApp</a>
        <span className="hint">WhatsApp opens with the message ready. You press send.</span>
      </div>
    </div>
  );
}
