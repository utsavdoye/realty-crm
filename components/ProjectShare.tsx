'use client';

import { useState } from 'react';
import { setProjectFlag } from '@/app/crm-actions';
import { ShareButtons } from '@/components/ShareButtons';

/** Website on/off and the client link on/off. Changes show at once; the save happens in the background
 *  and is undone with a message if it fails. */
export function ProjectShare({ id, web, crmLink, soldOut, mgr, onWebsite, isPublic, text }: {
  id: string; web: string | null; crmLink: string; soldOut: boolean; mgr: boolean;
  onWebsite: boolean | undefined; isPublic: boolean; text: string;
}) {
  const [onWeb, setOnWeb] = useState(onWebsite);
  const [pub, setPub] = useState(isPublic);
  const [error, setError] = useState('');

  async function flip(flag: 'on_website' | 'is_public', to: boolean) {
    setError('');
    const set = flag === 'on_website' ? setOnWeb : setPub;
    set(to);
    try {
      const r = await setProjectFlag(id, flag, to);
      if (r.error) { set(!to); setError(r.error); }
    } catch { set(!to); setError('Could not save. Check your internet and try again.'); }
  }

  const onSite = !!web && !!onWeb && !soldOut;
  return (
    <>
      <div className="share-box">
        {onSite ? (
          <><span className="hint">Link on your website</span><ShareButtons url={`${web}/property.html?p=${id}`} text={text} /></>
        ) : pub ? (
          <><span className="hint">Client link is on</span><ShareButtons url={crmLink} text={text} /></>
        ) : <span className="hint">Client link is off</span>}
        {mgr && !onSite && (
          <button type="button" className="btn sm ghost" onClick={() => flip('is_public', !pub)}>{pub ? 'Turn off' : 'Turn on client link'}</button>
        )}
      </div>
      {onWeb !== undefined && (
        <div className="share-box">
          <span className="hint">{soldOut ? 'Not on website (sold out)' : onWeb ? 'Shown on website' : 'Hidden from website'}</span>
          {mgr && !soldOut && (
            <button type="button" className="btn sm ghost" onClick={() => flip('on_website', !onWeb)}>{onWeb ? 'Hide from website' : 'Show on website'}</button>
          )}
        </div>
      )}
      {error && <p className="msg err">{error}</p>}
    </>
  );
}
