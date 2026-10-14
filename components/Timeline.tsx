type Item = { id: string; type: string; body: string; at: string; day: string; who: string | null; time: string };

const KIND: Record<string, { ic: string; l: string }> = {
  call: { ic: '☎', l: 'Call' }, whatsapp: { ic: '✉', l: 'WhatsApp' }, stage: { ic: '⚑', l: 'Status' }, visit: { ic: '⌂', l: 'Site visit' },
  enquiry: { ic: '★', l: 'Enquiry' }, assign: { ic: '→', l: 'Assigned' }, created: { ic: '+', l: 'Lead added' }, note: { ic: '✎', l: 'Note' }, step: { ic: '✓', l: 'Step done' },
};
const SHOW = 20;

function dayTitle(day: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const yest = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (day === today) return 'Today';
  if (day === yest) return 'Yesterday';
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function Days({ items }: { items: Item[] }) {
  const groups: { day: string; items: Item[] }[] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && g.day === it.day) g.items.push(it); else groups.push({ day: it.day, items: [it] });
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.day} className="tl-day">
          <div className="tl-dayh">{dayTitle(g.day)}</div>
          <ol className="timeline">
            {g.items.map((a) => {
              const k = KIND[a.type] ?? { ic: '•', l: a.type };
              return (
                <li key={a.id} className={`tl-${a.type}`}>
                  <span className="tl-ic" aria-hidden="true">{k.ic}</span>
                  <div>
                    <div className="tl-meta"><span className="tl-kind">{k.l}</span><span className="hint">{a.time.split(', ').pop()}{a.who ? ' · ' : ''}{a.who && <b>{a.who}</b>}{!a.who ? ' · automatic' : ''}</span></div>
                    <div className="tl-t">{a.body}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </>
  );
}

/** Lead history grouped by day, newest first: what happened, who did it, when. */
export function Timeline({ items }: { items: Item[] }) {
  if (!items.length) return <p className="hint">Nothing logged yet.</p>;
  return (
    <div className="tl-wrap">
      <Days items={items.slice(0, SHOW)} />
      {items.length > SHOW && (
        <details className="tl-more">
          <summary className="linkbtn small">Show {items.length - SHOW} older</summary>
          <Days items={items.slice(SHOW)} />
        </details>
      )}
    </div>
  );
}
