'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { visitCheckin } from '@/app/crm-actions';

/** "I'm at the site": takes the phone's GPS, finds the address and saves it on the visit. */
export function CheckInButton({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  function go() {
    setMsg(null);
    if (!('geolocation' in navigator)) { setMsg({ error: 'This phone cannot share its location.' }); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const r = await visitCheckin(visitId, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0);
      setBusy(false); setMsg(r);
      if (r.ok) router.refresh();
    }, (err) => {
      setBusy(false);
      setMsg({ error: err.code === err.PERMISSION_DENIED ? 'Location is blocked. Allow location for this site in the phone settings, then try again.' : 'Could not get your location. Go outside or near a window and try again.' });
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  return (
    <span className="checkin">
      <button type="button" className="btn sm primary" onClick={go} disabled={busy}>{busy ? 'Finding your location…' : '📍 I’m at the site'}</button>
      {msg?.ok && <span className="msg ok">{msg.ok}</span>}
      {msg?.error && <span className="msg err">{msg.error}</span>}
    </span>
  );
}
