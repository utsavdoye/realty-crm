'use client';

import { useState } from 'react';
import { askTestimonial } from '@/app/crm-actions';
import { ShareButtons } from '@/components/ShareButtons';

/** After the deal: a link the client opens on the website to write a testimonial. */
export function AskTestimonial({ leadId, name }: { leadId: string; name: string }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="stack" style={{ gap: 6 }}>
      {!url ? (
        <button type="button" className="btn sm" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          const r = await askTestimonial(leadId).catch(() => ({ error: 'Could not make the link. Try again.' } as { error?: string; url?: string }));
          setBusy(false);
          if (r.error) setError(r.error); else setUrl(r.url ?? '');
        }}>{busy ? 'Making the link…' : 'Ask for a testimonial'}</button>
      ) : (
        <>
          <span className="hint">Send this link to {name.split(' ')[0]}. Their testimonial shows on the website after you approve it (Website clients page).</span>
          <ShareButtons url={url} text={`Hi ${name.split(' ')[0]}, thank you for buying with us! Could you write a few words about your experience? It takes a minute:`} />
        </>
      )}
      {error && <p className="msg err">{error}</p>}
    </div>
  );
}
