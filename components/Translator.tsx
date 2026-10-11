'use client';

import { useEffect, useState } from 'react';

/**
 * Hindi mode for the whole site. The pages stay written in English; when someone picks हिंदी,
 * this swaps every known English text on screen for its Hindi version (from lib/hi.json) and keeps
 * doing it as pages change. Client data (names, notes, typed text) is never in the list, so it stays as it is.
 */
export const LANG_KEY = 'ed_lang';
type Lang = 'en' | 'hi';
const EVENT = 'ed-lang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);

export function getLang(): Lang {
  try { return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en'; } catch { return 'en'; }
}
export function setLang(l: Lang) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
}

type Tpl = { lits: string[]; hi: string; order: number[]; lit: string; pl: number[]; weak: boolean };
type Sent = { lits: string[]; hi: string };
let dict: Record<string, string> | null = null;
let tpls: Tpl[] = [];
const sents = new Map<string, Sent[]>(); // whole sentences split around values, by their first word piece

let loading: Promise<void> | null = null;
/** Starts downloading the Hindi words (once). Safe to call many times. */
export function preloadHindi() { loading ??= load().catch(() => { loading = null; }); return loading; }
async function load() {
  if (dict) return;
  const d = (await import('@/lib/hi.json')).default as unknown as { x: Record<string, string>; t: [string, string, number[]?][]; m?: [string[], string][] };
  for (const [lits, hi] of d.m ?? []) {
    const key = lits.find(Boolean);
    if (!key) continue;
    const list = sents.get(key) ?? [];
    list.push({ lits, hi });
    sents.set(key, list);
  }
  dict = d.x;
  tpls = d.t.flatMap(([en, hi, pl]) => {
    const parts = en.split(/\{(\d+)\}/);
    const lits = parts.filter((_, i) => i % 2 === 0);
    const order = parts.filter((_, i) => i % 2 === 1).map(Number);
    // Two values side by side ("{0}{1}") can't be told apart: skip those.
    if (lits.slice(1, -1).some((l) => !l)) return [];
    const lit = [...lits].sort((a, b) => b.length - a.length)[0].trim();
    const weak = lits.join('').replace(/[^A-Za-z]/g, '').length < 7;
    return [{ lits, hi, order, lit, pl: pl ?? [], weak }];
  }).sort((a, b) => b.lit.length - a.lit.length);
}

/** "Came in 5 min ago" vs ["Came in ", " min ago"] → ["5"]. Straight left-to-right search, so it's always fast. */
function matchTpl(s: string, lits: string[]): string[] | null {
  const first = lits[0], last = lits[lits.length - 1];
  if (!s.startsWith(first) || !s.endsWith(last) || s.length < first.length + last.length) return null;
  const vals: string[] = [];
  let pos = first.length;
  const end = s.length - last.length;
  for (let j = 1; j < lits.length - 1; j++) {
    const k = s.indexOf(lits[j], pos);
    if (k < 0 || k > end) return null;
    vals.push(s.slice(pos, k));
    pos = k + lits[j].length;
  }
  if (pos > end) return null;
  vals.push(s.slice(pos, end));
  return vals;
}
const memo = new Map<string, string | null>();
function tr(raw: string): string | null {
  const hit0 = memo.get(raw);
  if (hit0 !== undefined) return hit0;
  const r = trSlow(raw);
  if (memo.size > 20000) memo.clear();
  memo.set(raw, r);
  return r;
}
function trSlow(raw: string): string | null {
  // Saved notes come as lines ("Call: No answer" + the note): translate the lines that are app wording only.
  if (raw.trim().includes('\n')) {
    const lines = raw.split('\n');
    const outl = lines.map((l) => { const h = l.trim() ? tr(l) : null; return h === null ? l : l.replace(l.trim(), h); });
    return outl.some((l, i) => l !== lines[i]) ? outl.join('\n') : null;
  }
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || !/[A-Za-z]/.test(s) || !dict) return null;
  if (s === 's' || s === 'es') return ''; // English plural ending after a number
  const hit = dict[s];
  if (hit !== undefined) return hit;
  if (s.length > 400) return null; // long text is a note or message, not app wording
  for (const t of tpls) {
    if (t.lit && !s.includes(t.lit)) continue;
    const m = matchTpl(s, t.lits);
    if (!m) continue;
    // A plural slot must really be "" or "s" ("3 calls"), so "Asked to call back" in a note is never touched.
    if (t.pl.some((n) => !/^(e?s)?$/.test(m[t.order.indexOf(n)] ?? ''))) continue;
    // Short patterns only fit short text (a number or a name), not a sentence someone typed.
    if (t.weak && m.some((v, i) => !t.pl.includes(t.order[i]) && (v.length > 25 || v.trim().split(/\s+/).length > 5 || /[.!?]\s/.test(v)))) continue;
    // A value that holds a whole " · " list means the pattern swallowed too much ("Up to ₹65 L · Koramangala").
    if (!t.lits.some((l) => l.includes('·')) && m.some((v) => v.includes(' · '))) continue;
    return t.hi.replace(/\{(\d+)\}/g, (_, n) => {
      const v = m[t.order.indexOf(Number(n))] ?? '';
      if (v === 's' || v === 'es') return '';
      return valueHi(v);
    });
  }
  // Lists like "Apartment · 2, 3 BHK · Under construction": translate each part that is app wording.
  if (/ · | — |^· /.test(s)) {
    const lead = s.match(/^·\s*/)?.[0] ?? '';
    const parts = s.slice(lead.length).split(/( · | — )/);
    const outp = parts.map((x, i) => (i % 2 ? x : tr(x) ?? x));
    if (outp.some((x, i) => x !== parts[i])) return lead + outp.join('');
  }
  // Dates like "Fri, 16 Oct, 2:28 pm" or "Possession Jun 2029"
  const dt = dateHi(s);
  if (dt !== s) return dt;
  return null;
}

const DAYS: Record<string, string> = { Monday: 'सोमवार', Tuesday: 'मंगलवार', Wednesday: 'बुधवार', Thursday: 'गुरुवार', Friday: 'शुक्रवार', Saturday: 'शनिवार', Sunday: 'रविवार',
  Mon: 'सोम', Tue: 'मंगल', Wed: 'बुध', Thu: 'गुरु', Fri: 'शुक्र', Sat: 'शनि', Sun: 'रवि' };
const MONTHS: Record<string, string> = { January: 'जनवरी', February: 'फ़रवरी', March: 'मार्च', April: 'अप्रैल', May: 'मई', June: 'जून', July: 'जुलाई', August: 'अगस्त',
  September: 'सितंबर', October: 'अक्टूबर', November: 'नवंबर', December: 'दिसंबर', Jan: 'जन', Feb: 'फ़र', Mar: 'मार्च', Apr: 'अप्रैल', Jun: 'जून', Jul: 'जुला',
  Aug: 'अग', Sep: 'सित', Sept: 'सित', Oct: 'अक्टू', Nov: 'नव', Dec: 'दिस' };
const MON = Object.keys(MONTHS).join('|'), DAY = Object.keys(DAYS).join('|');
const DATE_RE = new RegExp(`\\b(\\d{1,2}) (${MON})\\b|\\b(${MON}) (\\d{4})\\b`, 'g');
/** Only touches day and month names that sit inside a date, so a client called "May" stays "May". */
function dateHi(s: string) {
  if (MONTHS[s]) return MONTHS[s]; // chart labels like "Oct"
  const lab = s.match(new RegExp(`^(${MON}):`));
  if (lab) return MONTHS[lab[1]] + s.slice(lab[1].length);
  if (!DATE_RE.test(s)) return s;
  DATE_RE.lastIndex = 0;
  let out = s.replace(DATE_RE, (m, d1, m1, m2, y) => (d1 ? `${d1} ${MONTHS[m1]}` : `${MONTHS[m2]} ${y}`));
  out = out.replace(new RegExp(`(^|[\\s(])(${DAY}),`, 'g'), (m, a, d) => `${a}${DAYS[d]},`);
  return out;
}

const done = new WeakMap<Node, string>(); // node → the Hindi we put there
const origText = new Map<Text, string>(); // node → its English, to switch back without reloading
const origAttr = new Map<Element, Record<string, string>>();
let on = false;

function doText(n: Text) {
  const v = n.nodeValue ?? '';
  if (done.get(n) === v) return;
  const par = n.parentElement;
  if (par?.hasAttribute('data-hi')) { doHi(par); return; }
  if (par && grouped.has(par)) {
    if (doGroup(par)) return;
    // The sentence changed shape: put its pieces back to English and translate them one by one.
    grouped.delete(par);
    const kids = Array.from(par.childNodes).filter((c): c is Text => c.nodeType === 3);
    kids.forEach((t) => { const e = english(t); done.delete(t); origText.delete(t); if (t.nodeValue !== e) t.nodeValue = e; });
    kids.forEach((t) => { if (t !== n) doText(t); });
  }
  if (v.length < 2 && v !== 's') return;
  const h = tr(n.nodeValue ?? '');
  if (h === null) return;
  const p = n.parentElement;
  if (!p || SKIP.has(p.tagName) || p.closest('[translate="no"],[contenteditable="true"]')) return;
  const lead = v.match(/^\s*/)![0], tail = v.match(/\s*$/)![0];
  const out = h ? lead + h + tail : '';
  done.set(n, out);
  if (out !== v) { origText.set(n, v); n.nodeValue = out; }
}
function doEl(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const h = tr(v);
    if (h && el.closest('[translate="no"]')) return;
    if (h && h !== v) { const o = origAttr.get(el) ?? {}; o[a] = v; origAttr.set(el, o); el.setAttribute(a, h); }
  }
}
/** <p data-hi="…">English</p>: the page already wrote the Hindi for this sentence. */
function doHi(el: Element) {
  const hi = el.getAttribute('data-hi');
  const n = el.firstChild;
  if (!hi || !n || n.nodeType !== 3 || el.childNodes.length !== 1) return;
  const t = n as Text;
  if (done.get(t) === t.nodeValue) return;
  origText.set(t, t.nodeValue ?? '');
  done.set(t, hi);
  t.nodeValue = hi;
}
function walk(root: Node) {
  if (root.nodeType === 3) { const p = (root as Text).parentElement; if (p?.hasAttribute('data-hi')) doHi(p); else doText(root as Text); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (SKIP.has(el.tagName)) return;
  if (el.hasAttribute('data-hi')) doHi(el);
  el.querySelectorAll('[data-hi]').forEach(doHi);
  doEl(el);
  el.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach(doEl);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  const list: Text[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n as Text);
  for (const n of list) {
    const p = n.parentElement;
    if (p && !seen.has(p)) { seen.add(p); if (sents.size && doGroup(p)) continue; }
    if (p && grouped.has(p)) continue;
    doText(n);
  }
}

const grouped = new WeakSet<Element>(); // elements whose sentence we translate as a whole
const clean = (v: string) => v.replace(/\s+/g, ' ').trim();
const english = (n: Text) => (origText.has(n) && done.get(n) === n.nodeValue ? origText.get(n)! : n.nodeValue ?? '');

/** Matches the element's text pieces against a whole sentence like "Came in {0} · {1} new". */
function matchSent(toks: string[], lits: string[]): string[] | null {
  const vals: string[] = [];
  let i = 0;
  const skipWs = () => { while (i < toks.length && !clean(toks[i])) i++; };
  if (lits[0]) { skipWs(); if (clean(toks[i] ?? '') !== lits[0]) return null; i++; }
  for (let j = 1; j < lits.length; j++) {
    const lit = lits[j];
    let k = i;
    if (lit) { while (k < toks.length && clean(toks[k]) !== lit) k++; if (k >= toks.length) return null; }
    else k = toks.length;
    vals.push(toks.slice(i, k).join(''));
    i = lit ? k + 1 : k;
  }
  for (; i < toks.length; i++) if (clean(toks[i])) return null;
  return vals;
}
function valueHi(v: string) {
  const t = clean(v);
  if (t === 's' || t === 'es') return '';
  if (!t) return v;
  const h = tr(t) ?? tr(t[0].toUpperCase() + t.slice(1)); // "site visit" inside "Finish site visit"

  return h !== null ? v.replace(t, h) : v;
}
/** Translate a whole sentence that the page builds from several text pieces. Returns false if none fits. */
function doGroup(el: Element): boolean {
  const nodes: Text[] = [];
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) nodes.push(c as Text);
    else if (c.nodeType !== 8) return false; // has a child element: leave to piece-by-piece
  }
  if (nodes.length < 2) return false;
  const toks = nodes.map(english);
  // Try every sentence that shares a word piece with this element; the one with the most fixed words wins.
  let out: string | null = null;
  let best = -1;
  const tried = new Set<Sent>();
  for (const t of toks) {
    const list = sents.get(clean(t));
    if (!list) continue;
    for (const s of list) {
      if (tried.has(s)) continue;
      tried.add(s);
      const score = s.lits.filter(Boolean).length;
      if (score <= best) continue;
      const vals = matchSent(toks, s.lits);
      if (!vals) continue;
      best = score;
      out = s.hi.replace(/\{(\d+)\}/g, (_, n) => valueHi(vals[Number(n)] ?? '')).replace(/\s+/g, ' ').trim();
    }
  }
  if (out === null) return false;
  if (el.closest('[translate="no"],[contenteditable="true"]')) return false;
  grouped.add(el);
  nodes.forEach((n, i) => {
    const want = i === 0 ? out! + (/\s$/.test(toks[toks.length - 1]) ? ' ' : '') : '';
    origText.set(n, toks[i]);
    done.set(n, want);
    if (n.nodeValue !== want) n.nodeValue = want;
  });
  return true;
}

function restore() {
  origText.forEach((v, n) => { if (n.isConnected && done.get(n) === n.nodeValue) n.nodeValue = v; });
  origAttr.forEach((o, el) => { if (el.isConnected) for (const [a, v] of Object.entries(o)) el.setAttribute(a, v); });
  origText.clear(); origAttr.clear();
}
// Forget nodes that left the page (keeps memory small on long sessions).
function prune() {
  origText.forEach((_, n) => { if (!n.isConnected) origText.delete(n); });
  origAttr.forEach((_, el) => { if (!el.isConnected) origAttr.delete(el); });
}

/** Put once in the root layout. */
export function Translator() {
  useEffect(() => {
    let obs: MutationObserver | null = null;
    let queue: Node[] = [];
    let raf = 0;
    const show = () => document.documentElement.classList.remove('xl8');
    const flush = () => { raf = 0; const q = queue; queue = []; if (on) q.forEach((n) => n.isConnected && walk(n)); };
    async function apply() {
      const want = getLang() === 'hi';
      if (!want) {
        if (on) { on = false; obs?.disconnect(); obs = null; restore(); document.documentElement.lang = 'en-IN'; }
        show(); return;
      }
      if (on) { show(); return; }
      await preloadHindi();
      if (!dict || getLang() !== 'hi') { show(); return; }
      on = true;
      document.documentElement.lang = 'hi';
      walk(document.body);
      const t0 = document.title.split(' · ')[0], th = tr(t0);
      if (th) document.title = document.title.replace(t0, th);
      show();
      obs = new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') doText(m.target as Text);
          else if (m.type === 'attributes') doEl(m.target as Element);
          else m.addedNodes.forEach((n) => queue.push(n));
        }
        // Handle new content in one go, right before the screen paints.
        if (queue.length && !raf) raf = requestAnimationFrame(flush);
      });
      obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    apply();
    window.addEventListener(EVENT, apply);
    const tidy = setInterval(prune, 60000);
    // Fetch the Hindi words quietly once the page is idle, so tapping हिंदी is instant.
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    const t = setTimeout(() => (idle ? idle(() => preloadHindi()) : preloadHindi()), 3000);
    return () => { window.removeEventListener(EVENT, apply); obs?.disconnect(); clearInterval(tidy); clearTimeout(t); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}

/** Runs before the page shows: hides it for a moment in Hindi mode so English doesn't flash first. */
export const LANG_BOOT = `try{if(localStorage.getItem('${LANG_KEY}')==='hi'){var d=document.documentElement;d.classList.add('xl8');setTimeout(function(){d.classList.remove('xl8')},700)}}catch(e){}`;

/** The English | हिंदी switch. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const [lang, set] = useState<Lang>('en');
  useEffect(() => { set(getLang()); }, []);
  const pick = (l: Lang) => { if (l === lang) return; set(l); setLang(l); };
  return (
    <span className={`langsw ${className}`} role="group" aria-label="Language" translate="no">
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => pick('en')}>English</button>
      <button type="button" className={lang === 'hi' ? 'on' : ''} aria-pressed={lang === 'hi'} onClick={() => pick('hi')} onPointerEnter={() => preloadHindi()} onTouchStart={() => preloadHindi()}>हिंदी</button>
    </span>
  );
}
