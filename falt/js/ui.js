/** Gemensamma gränssnittsfunktioner: paneler, toast, formatering. */

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('visa');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visa'), 2800);
}

/* ── Paneler ── */

export function oppnaPanel(vilken, html) {
  const overlay = $(vilken === 'dorr' ? 'dorrOverlay' : 'modalOverlay');
  const panel = $(vilken === 'dorr' ? 'dorrPanel' : 'modalPanel');
  panel.innerHTML =
    '<div class="panelhuvud"><div class="greppa"></div>' +
    '<button class="stangkryss" type="button" aria-label="Stäng">✕</button></div>' + html;
  panel.querySelector('.stangkryss').onclick = () => stangPanel(vilken);
  overlay.classList.add('open');
  panel.scrollTop = 0;
  return panel;
}

export function stangPanel(vilken) {
  $(vilken === 'dorr' ? 'dorrOverlay' : 'modalOverlay').classList.remove('open');
}

export function kopplaStangning() {
  ['dorrOverlay', 'modalOverlay'].forEach((id) => {
    $(id).addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.classList.remove('open'); });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { stangPanel('dorr'); stangPanel('modal'); }
  });
}

/**
 * Håller layouten inom det som faktiskt syns. I telefonens inbyggda
 * webbläsare ligger verktygsfälten ovanpå sidan, så 100dvh blir högre än
 * ytan man ser — kartan hamnade delvis utanför och panelen klipptes.
 */
export function kopplaLayout() {
  const rot = document.documentElement;
  const mat = () => {
    const vv = window.visualViewport;
    rot.style.setProperty('--app-h', Math.round(vv ? vv.height : window.innerHeight) + 'px');
    const topp = $('topp');
    if (topp && topp.offsetHeight) rot.style.setProperty('--topp-h', topp.offsetHeight + 'px');
  };
  mat();
  ['resize', 'orientationchange'].forEach((h) => window.addEventListener(h, mat));
  if (window.visualViewport) {
    ['resize', 'scroll'].forEach((h) => window.visualViewport.addEventListener(h, mat));
  }
  if (window.ResizeObserver && $('topp')) new ResizeObserver(mat).observe($('topp'));
  return mat;
}

/* ── Datum och tid ── */

export const iso = (d) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const idag = () => iso(new Date());
export function plusDagar(n, från) {
  const d = från ? new Date(från + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

const DAGAR = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'];
const MAN = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export function visaDatum(s) {
  if (!s) return '';
  if (s === idag()) return 'Idag';
  if (s === plusDagar(1)) return 'Imorgon';
  if (s === plusDagar(-1)) return 'Igår';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt)) return s;
  // Årtal tas med när datumet ligger utanför innevarande år, t.ex. långa spärrar.
  const ar = y === new Date().getFullYear() ? '' : ' ' + y;
  return DAGAR[dt.getDay()] + ' ' + dt.getDate() + ' ' + MAN[dt.getMonth()] + ar;
}

export function visaTidpunkt(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const kl = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return visaDatum(iso(d)).toLowerCase() + ' kl. ' + kl;
}

export function sedan(ms) {
  if (!ms) return '';
  const dagar = Math.floor((Date.now() - ms) / 86400000);
  if (dagar <= 0) return 'idag';
  if (dagar === 1) return 'igår';
  if (dagar < 30) return dagar + ' dagar sedan';
  const man = Math.round(dagar / 30);
  return man + (man === 1 ? ' månad sedan' : ' månader sedan');
}

/** Måndag i innevarande vecka. */
export function veckostart(datum = new Date()) {
  const d = new Date(datum);
  const dag = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dag);
  return iso(d);
}

/* ── Etiketter ── */

export const STATUS_TEXT = {
  ejbesokt: 'Ej besökt',
  bokat: 'Bokat',
  ejsvar: 'Inget svar',
  aterkom: 'Återkom',
  nej: 'Nej',
};

export const RESULTAT_TEXT = {
  bokat: 'Bokat',
  ejsvar: 'Inget svar',
  nej: 'Nej',
  aterkom: 'Återkom',
};

export const STATUS_FARG = {
  ejbesokt: '#2a63a8',
  bokat: '#217a4b',
  ejsvar: '#8a6a12',
  aterkom: '#b3591a',
  nej: '#b3271c',
  sparrad: '#6d6864',
};

export const NEJ_ORSAKER = [
  'Inte intresserad', 'Har redan kontrollerat taket', 'Ska sälja huset',
  'För dyrt', 'Vill tänka', 'Har redan offert', 'Annat',
];

export function procent(del, av) {
  return av ? Math.round((del / av) * 100) : 0;
}
