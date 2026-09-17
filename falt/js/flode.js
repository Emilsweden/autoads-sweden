/**
 * Nyheter — vad som hänt, beskuret efter roll av servern.
 *
 * Mötesbokaren ser sina egna bokningar och vad de lett till, besiktaren sina
 * möten, Admin Besiktare allt som rör besiktarna, Mötesbokare+ allt.
 */

import { anrop } from './api.js';
import { $, esc, toast, visaTidpunkt } from './ui.js';
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

  if (S.vy === 'nyheter') $('vySub').textContent = nyheter.length + ' händelser';

  ruta.innerHTML = nyheter.length
    ? '<p class="karttips">Svep en nyhet åt sidan för att ta bort den. ' +
      'Den försvinner bara för dig — de andra har kvar sin.</p>' +
      '<div class="flode">' + nyheter.map((n) =>
      '<div class="flode-svep" data-id="' + esc(n.id) + '">' +
      '<div class="flode-rad flode-' + esc(n.typ) + '">' +
      '<span class="flode-ikon" aria-hidden="true">' + (IKON[n.typ] || '•') + '</span>' +
      '<span class="flode-text">' + esc(n.text) +
      '<span class="under">' + esc(visaTidpunkt(n.skapad)) + '</span></span>' +
      '<button class="flode-bort" data-bort="' + esc(n.id) + '" aria-label="Ta bort">✕</button>' +
      '</div></div>').join('') + '</div>'
    : '<div class="tom">Inget har hänt än.</div>';

  ruta.querySelectorAll('[data-bort]').forEach((k) => {
    k.onclick = (ev) => { ev.stopPropagation(); dolj(k.dataset.bort); };
  });
  kopplaSvep(ruta);
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
}
