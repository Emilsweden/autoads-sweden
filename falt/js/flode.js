/**
 * Nyhetsflödet — vad som hänt i laget, beskuret efter roll av servern.
 *
 * Mötesbokaren ser sina egna bokningar och vad de lett till, säljaren sina
 * möten, Admin Säljare det som rör säljarna, Mötesbokare+ allt.
 */

import { anrop } from './api.js';
import { $, esc, visaTidpunkt } from './ui.js';
import { S } from './state.js';

const IKON = {
  bokning: '📅',
  andring: '✏️',
  avbokning: '🚫',
  aterkoppling: '💬',
  tid: '🕑',
  konto: '👤',
};

let nyheter = [];

export async function rita() {
  const ruta = $('flodeInnehall');
  if (!ruta) return;
  if (!nyheter.length) ruta.innerHTML = '<div class="tom">Hämtar flödet…</div>';

  try {
    nyheter = (await anrop('nyheter', { antal: 80 })).nyheter || [];
  } catch (e) {
    ruta.innerHTML = '<div class="tom">Kunde inte hämta flödet: ' + esc(e.message) + '</div>';
    return;
  }

  if (S.vy === 'bokningar') $('vySub').textContent = nyheter.length + ' händelser';

  ruta.innerHTML = nyheter.length
    ? '<div class="flode">' + nyheter.map((n) =>
      '<div class="flode-rad flode-' + esc(n.typ) + '">' +
      '<span class="flode-ikon" aria-hidden="true">' + (IKON[n.typ] || '•') + '</span>' +
      '<span class="flode-text">' + esc(n.text) +
      '<span class="under">' + esc(visaTidpunkt(n.skapad)) + '</span></span>' +
      '</div>').join('') + '</div>'
    : '<div class="tom">Inget har hänt än.</div>';
}

/** Töm inför nästa hämtning, t.ex. vid utloggning. */
export function nollstall() {
  nyheter = [];
}
