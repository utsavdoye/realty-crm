'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { sendRequirement, type ReqState } from '@/app/public-actions';
import { PhoneInput } from '@/components/PhoneInput';
import { BHKS, PTYPES, PURPOSES } from '@/lib/crm';

// Budgets are in lakhs, same as the rest of the CRM (100 = ₹1 Cr).
export const BUDGETS: [string, number | null, number | null][] = [
  ['Under ₹30 L', null, 30], ['₹30 – 50 L', 30, 50], ['₹50 – 75 L', 50, 75],
  ['₹75 L – 1 Cr', 75, 100], ['₹1 – 1.5 Cr', 100, 150], ['₹1.5 – 2.5 Cr', 150, 250], ['Above ₹2.5 Cr', 250, null],
];
const WHEN = ['Right away', 'Within 3 months', '3 – 6 months', 'Just exploring'];
const LOAN = ['Yes', 'No', 'Not sure'];
const SLOTS = ['Morning', 'Afternoon', 'Evening', 'Any time'];

function Pick({ name, options, required, value, onChange }: { name: string; options: string[]; required?: boolean; value?: string; onChange?: (v: string) => void }) {
  return (
    <div className="rpicks" role="radiogroup">
      {options.map((o, i) => (
        <label key={o} className="rpick">
          <input type="radio" name={name} value={o} required={required && i === 0} checked={value === undefined ? undefined : value === o}
            onChange={(e) => onChange?.(e.target.value)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

function Send() {
  const { pending } = useFormStatus();
  return <button className="btn primary block big" disabled={pending}>{pending ? 'Sending…' : 'Find homes for me →'}</button>;
}

export function RequirementForm({ token, by, areas, advisor }: { token: string; by: string; areas: string[]; advisor: string | null }) {
  const [state, action] = useFormState<ReqState, FormData>(sendRequirement, null);
  const [budget, setBudget] = useState('');
  const b = BUDGETS.find(([l]) => l === budget);

  if (state?.ok) {
    const who = state.advisor || advisor || 'Our advisor';
    return (
      <section className="pub-card req-done"><div className="pub-body">
        <div className="req-tick">✓</div>
        <h2>Thank you, {state.name}!</h2>
        {state.fits ? (
          <p><b>Good news: {state.fits} of our project{state.fits === 1 ? '' : 's'} fit{state.fits === 1 ? 's' : ''} your budget.</b> {who} will call you soon with the details, prices and the best units.</p>
        ) : (
          <p>{who} will look for homes that match and call you soon.</p>
        )}
        <p className="hint">Save our number when we call, so you get photos and price lists on WhatsApp.</p>
      </div></section>
    );
  }

  return (
    <form action={action} className="pub-card"><div className="pub-body req-form">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="by" value={by} />
      <input type="hidden" name="bmin" value={b?.[1] ?? ''} />
      <input type="hidden" name="bmax" value={b?.[2] ?? ''} />

      <fieldset><legend>What are you looking for?</legend><Pick name="bhk" options={BHKS} /></fieldset>
      <fieldset><legend>Type of property</legend><Pick name="ptype" options={PTYPES} /></fieldset>
      <fieldset><legend>Your budget</legend><Pick name="budget" options={BUDGETS.map(([l]) => l)} value={budget} onChange={setBudget} /></fieldset>
      <label className="field"><span className="legend">Which area do you prefer?</span>
        <input name="location" list="req-areas" maxLength={200} placeholder={areas[0] ? `e.g. ${areas.slice(0, 2).join(', ')}` : 'e.g. near my office or school'} />
        <datalist id="req-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
      </label>
      <fieldset><legend>Buying for</legend><Pick name="purpose" options={PURPOSES} /></fieldset>
      <fieldset><legend>When do you plan to buy?</legend><Pick name="timeline" options={WHEN} /></fieldset>
      <fieldset><legend>Will you need a home loan?</legend><Pick name="loan" options={LOAN} /></fieldset>

      <div className="req-contact">
        <label className="field"><span className="legend">Your name</span><input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label className="field"><span className="legend">Mobile number</span><PhoneInput required /></label>
        <fieldset><legend>Best time to call you</legend><Pick name="slot" options={SLOTS} /></fieldset>
        <label className="field"><span className="legend">Anything else? (optional)</span>
          <textarea name="note" rows={2} maxLength={500} placeholder="e.g. east facing, near a school, ground floor for parents" /></label>
      </div>
      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      <Send />
      <p className="hint center">🔒 Your number is safe with us. We call only about homes you asked for.</p>
    </div></form>
  );
}
