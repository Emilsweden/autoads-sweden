/**
 * Nyheter — vad som hänt, beskuret efter roll av servern.
 *
 * Mötesbokaren ser sina egna bokningar och vad de lett till, besiktaren sina
 * möten, Admin Besiktare allt som rör besiktarna, Mötesbokare+ allt.
 */

import { anrop } from './api.js';
import { $, esc, toast, visaTidpunkt, veckostart, plusDagar } from './ui.js';
import { S } from './state.js';

const IKON = {
  bokning: '📅',
  andring: '✏️',
  avbokning: '🚫',
  aterkoppling: '💬',
  tid: '🕑',
  blockering: '⛔',
  konto: '👤',
};

let nyheter = [];
/*
 * Gränsen mellan Nya och Sedda. Den läses när vyn öppnas och står still
 * medan man tittar — annars skulle det nya hoppa över till Sedda i samma
 * ögonblick som flödet ritats om.
 */
let grans = null;

/** Anropas när vyn öppnas: nästa ritning läser gränsen på nytt. */
export function oppnad() {
  grans = null;
}

export async function rita() {
  const ruta = $('flodeInnehall');
  if (!ruta) return;
  if (!nyheter.length) ruta.innerHTML = '<div class="tom">Hämtar flödet…</div>';

  let svar;
  try {
    svar = await anrop('nyheter', { antal: 120 });
  } catch (e) {
    ruta.innerHTML = '<div class="tom">Kunde inte hämta flödet: ' + esc(e.message) + '</div>';
    return;
  }
  nyheter = svar.nyheter || [];
  if (grans === null) grans = svar.sedda_till || 0;

  const nya = nyheter.filter((n) => n.skapad > grans);
  const sedda = nyheter.filter((n) => n.skapad <= grans);
  if (S.vy === 'nyheter') {
    $('vySub').textContent = nya.length ? nya.length + ' nya' : nyheter.length + ' händelser';
  }

  ruta.innerHTML = nyheter.length
    ? '<div class="listverktyg"><button class="knapp-mork" id="fRensa">Rensa allt</button></div>' +
      (nya.length ? '<h3 class="flode-rubrik">Nya</h3>' + grupperat(nya, true) : '') +
      (sedda.length ? '<h3 class="flode-rubrik">Sedda</h3>' + grupperat(sedda, false) : '') +
      '<p class="karttips">Svep en nyhet åt sidan för att ta bort den. ' +
      'Den försvinner bara för dig — de andra har kvar sin.</p>'
    : '<div class="tom">Inget nytt.</div>';

  ruta.querySelectorAll('[data-bort]').forEach((k) => {
    k.onclick = (ev) => { ev.stopPropagation(); dolj(k.dataset.bort); };
  });
  if ($('fRensa')) $('fRensa').onclick = rensa;
  kopplaSvep(ruta);

  // Det som visats är sett. Nästa gång vyn öppnas står det under Sedda.
  const nyast = nyheter.reduce((m, n) => Math.max(m, n.skapad), 0);
  if (nyast > (svar.sedda_till || 0)) anrop('nyheter-sedda', { till: nyast }).catch(() => {});
}

/** Den här veckan, förra veckan och äldre — var för sig. */
function grupperat(lista, nya) {
  const denna = new Date(veckostart() + 'T00:00:00').getTime();
  const forra = new Date(plusDagar(-7, veckostart()) + 'T00:00:00').getTime();
  const grupper = [
    ['Den här veckan', lista.filter((n) => n.skapad >= denna)],
    ['Förra veckan', lista.filter((n) => n.skapad < denna && n.skapad >= forra)],
    ['Äldre', lista.filter((n) => n.skapad < forra)],
  ].filter(([, rader]) => rader.length);
  return grupper.map(([rubrik, rader]) =>
    '<div class="flode-grupp">' + esc(rubrik) + '</div>' +
    '<div class="flode">' + rader.map((n) =>
      '<div class="flode-svep" data-id="' + esc(n.id) + '">' +
      '<div class="flode-rad flode-' + esc(n.typ) + (nya ? ' flode-ny' : '') + '">' +
      '<span class="flode-ikon" aria-hidden="true">' + (IKON[n.typ] || '•') + '</span>' +
      '<span class="flode-text">' + esc(n.text) +
      '<span class="under">' + esc(visaTidpunkt(n.skapad)) + '</span></span>' +
      '<button class="flode-bort" data-bort="' + esc(n.id) + '" aria-label="Ta bort">✕</button>' +
      '</div></div>').join('') + '</div>').join('');
}

/** Rensa allt — flödet töms för den här användaren, ingen annan. */
async function rensa() {
  if (!confirm('Rensa alla nyheter? De försvinner bara för dig.')) return;
  try {
    await anrop('nyheter-rensa', {});
    nyheter = [];
    grans = null;
    toast('Nyheterna är rensade');
    rita();
  } catch (e) {
    toast('Kunde inte rensa: ' + e.message);
  }
}

/**
 * Sveper man en nyhet åt sidan försvinner den för en själv. Servern skriver
 * en rad i nyhet_dold — nyheten finns kvar för alla andra som ser den.
 */
async function dolj(id) {
  const rad = document.querySelector('.flode-svep[data-id="' + CSS.escape(id) + '"]');
  if (rad) rad.classList.add('bortsvept');
  nyheter = nyheter.filter((n) => n.id !== id);
  try {
    await anrop('nyhet-dolj', { id });
  } catch (e) {
    toast('Kunde inte ta bort nyheten: ' + e.message);
    rita();
    return;
  }
  // Rita om först när animeringen hunnit synas.
  setTimeout(() => { if (S.vy === 'nyheter') rita(); }, 220);
}

/** Svep åt vänster eller höger tar bort raden. */
function kopplaSvep(ruta) {
  ruta.querySelectorAll('.flode-svep').forEach((rad) => {
    let startX = 0;
    let dx = 0;
    let drar = false;

    rad.addEventListener('touchstart', (ev) => {
      startX = ev.touches[0].clientX;
      dx = 0;
      drar = true;
      rad.style.transition = 'none';
    }, { passive: true });

    rad.addEventListener('touchmove', (ev) => {
      if (!drar) return;
      dx = ev.touches[0].clientX - startX;
      rad.style.transform = 'translateX(' + dx + 'px)';
      rad.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / 260));
    }, { passive: true });

    rad.addEventListener('touchend', () => {
      if (!drar) return;
      drar = false;
      rad.style.transition = '';
      // En tredjedel av bredden räcker; mindre än så är ett misstag.
      if (Math.abs(dx) > rad.offsetWidth / 3) {
        dolj(rad.dataset.id);
        return;
      }
      rad.style.transform = '';
      rad.style.opacity = '';
    });
  });
}

/** Töm inför nästa hämtning, t.ex. vid utloggning. */
export function nollstall() {
  nyheter = [];
  grans = null;
}
