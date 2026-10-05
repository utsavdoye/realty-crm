'use client';
import { useState } from 'react';

const KINDS = [
  ['99acres', '99acres'], ['magicbricks', 'MagicBricks'], ['housing', 'Housing.com'],
  ['meta', 'Facebook / Instagram ads'], ['google', 'Google Ads'], ['website', 'Your website form'], ['generic', 'Other tool'],
];

export function SourceKindPicker() {
  const [kind, setKind] = useState('99acres');
  return (
    <>
      <label className="field"><span className="label">Where do these leads come from?</span>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {kind === 'meta' && (
        <label className="field"><span className="label">Facebook page ID</span>
          <input name="page_id" inputMode="numeric" placeholder="Found in your page’s About → Page transparency" required />
        </label>
      )}
    </>
  );
}
