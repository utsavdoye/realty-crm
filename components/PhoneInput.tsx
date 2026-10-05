'use client';

import { useState } from 'react';
import { COUNTRIES, joinPhone } from '@/lib/countries';

/** Country code + number. Sends one hidden field `name` with the full number. */
export function PhoneInput({ name = 'phone', defaultCc = '+91', required, autoFocus, onValue }: { name?: string; defaultCc?: string; required?: boolean; autoFocus?: boolean; onValue?: (v: string) => void }) {
  const [cc, setCc] = useState(defaultCc);
  const [num, setNum] = useState('');
  const full = joinPhone(cc, num);
  return (
    <div className="prefix-input">
      <select className="cc" value={cc} onChange={(e) => { setCc(e.target.value); onValue?.(joinPhone(e.target.value, num)); }} aria-label="Country code">
        {COUNTRIES.map(([c, n]) => <option key={c + n} value={c}>{c} {n}</option>)}
      </select>
      <input inputMode="numeric" autoComplete="tel-national" autoFocus={autoFocus} required={required} placeholder={cc === '+91' ? '98765 43210' : 'Mobile number'}
        value={num} onChange={(e) => { setNum(e.target.value); onValue?.(joinPhone(cc, e.target.value)); }} maxLength={16} aria-label="Mobile number" />
      <input type="hidden" name={name} value={full} />
    </div>
  );
}
