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
  if (l === 'en') { location.reload(); return; } // back to English: simplest is a fresh page
  window.dispatchEvent(new Event(EVENT));
}

type Tpl = { re: RegExp; hi: string; order: number[]; lit: string };
let dict: Record<string, string> | null = null;
let tpls: Tpl[] = [];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function load() {
  if (dict) return;
  const d = (await import('@/lib/hi.json')).default as unknown as { x: Record<string, string>; t: [string, string][] };
  dict = d.x;
  tpls = d.t.map(([en, hi]) => {
    const parts = en.split(/\{(\d+)\}/);
    const order: number[] = [];
    let src = '^';
    parts.forEach((p, i) => { if (i % 2) { src += '(.*?)'; order.push(Number(p)); } else src += esc(p); });
    const lit = parts.filter((_, i) => i % 2 === 0).sort((a, b) => b.length - a.length)[0].trim();
    return { re: new RegExp(src + '$', 's'), hi, order, lit };
  }).sort((a, b) => b.lit.length - a.lit.length);
}

function tr(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || !/[A-Za-z]/.test(s) || !dict) return null;
  if (s === 's' || s === 'es') return ''; // English plural ending after a number
  const hit = dict[s];
  if (hit !== undefined) return hit;
  for (const t of tpls) {
    if (t.lit && !s.includes(t.lit)) continue;
    const m = t.re.exec(s);
    if (!m) continue;
    return t.hi.replace(/\{(\d+)\}/g, (_, n) => {
      const v = m[t.order.indexOf(Number(n)) + 1] ?? '';
      if (v === 's' || v === 'es') return '';
      return dict![v.trim()] ?? v;
    });
  }
  return null;
}

const done = new WeakMap<Node, string>(); // node → the Hindi we put there

function doText(n: Text) {
  const v = n.nodeValue ?? '';
  if (done.get(n) === v) return;
  const p = n.parentElement;
  if (!p || SKIP.has(p.tagName) || p.closest('[translate="no"],[contenteditable="true"]')) return;
  const h = tr(v);
  if (h === null) return;
  const lead = v.match(/^\s*/)![0], tail = v.match(/\s*$/)![0];
  const out = h ? lead + h + tail : '';
  done.set(n, out);
  if (out !== v) n.nodeValue = out;
}
function doEl(el: Element) {
  if (el.closest('[translate="no"]')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const h = tr(v);
    if (h) el.setAttribute(a, h);
  }
}
function walk(root: Node) {
  if (root.nodeType === 3) { doText(root as Text); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (SKIP.has(el.tagName)) return;
  doEl(el);
  el.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach(doEl);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) doText(n as Text);
}

/** Put once in the root layout. */
export function Translator() {
  useEffect(() => {
    let obs: MutationObserver | null = null;
    const show = () => document.documentElement.classList.remove('xl8');
    async function start() {
      if (getLang() !== 'hi' || obs) { show(); return; }
      try { await load(); } catch { show(); return; }
      document.documentElement.lang = 'hi';
      walk(document.body);
      const t0 = document.title.split(' · ')[0], th = tr(t0);
      if (th) document.title = document.title.replace(t0, th);
      show();
      obs = new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') doText(m.target as Text);
          else if (m.type === 'attributes') doEl(m.target as Element);
          else m.addedNodes.forEach(walk);
        }
      });
      obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    start();
    window.addEventListener(EVENT, start);
    return () => { window.removeEventListener(EVENT, start); obs?.disconnect(); };
  }, []);
  return null;
}

/** Runs before the page shows: hides it for a moment in Hindi mode so English doesn't flash first. */
export const LANG_BOOT = `try{if(localStorage.getItem('${LANG_KEY}')==='hi'){var d=document.documentElement;d.classList.add('xl8');setTimeout(function(){d.classList.remove('xl8')},2500)}}catch(e){}`;

/** The English | हिंदी switch. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const [lang, set] = useState<Lang>('en');
  useEffect(() => { set(getLang()); }, []);
  const pick = (l: Lang) => { if (l === lang) return; set(l); setLang(l); };
  return (
    <span className={`langsw ${className}`} role="group" aria-label="Language" translate="no">
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => pick('en')}>English</button>
      <button type="button" className={lang === 'hi' ? 'on' : ''} aria-pressed={lang === 'hi'} onClick={() => pick('hi')}>हिंदी</button>
    </span>
  );
}
