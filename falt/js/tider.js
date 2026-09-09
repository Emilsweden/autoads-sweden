/**
 * Säljarnas tider — vilka timmar varje takbesiktare tar möten.
 *
 * Regeln är serverns: har en säljare inte lagt in något för en dag är hela
 * standarddagen ledig. Lägger han in tider gäller bara de. Säljaren styr sin
 * egen dag; Admin Säljare och Mötesbokare+ styr allas.
 */

import { anrop } from './api.js';
import { $, esc, toast, idag, plusDagar, visaDatum } from './ui.js';
import { S, kan } from './state.js';

let dag = idag();
let data = null;
let valdSaljare = '';

export async function rita() {
  const ruta = $('tiderInnehall');
  if (!ruta) return;
  if (!data) ruta.innerHTML = '<div class="tom">Hämtar tider…</div>';

  try {
    data = await anrop('saljartider', { fran: dag, till: dag });
  } catch (e) {
    ruta.innerHTML = '<div class="tom">Kunde inte hämta tiderna: ' + esc(e.message) + '</div>';
    return;
  }

  const lag = data.saljare || [];
  if (!lag.length) {
    ruta.innerHTML = topp() +
      '<div class="tom">Ingen säljare är upplagd än. En säljare läggs upp under ' +
      'Admin → Användare med rollen Säljare.</div>';
    kopplaTopp();
    return;
  }

  // Säljaren ser bara sin egen dag; övriga väljer vem de tittar på.
  const egen = data.eget_schema;
  if (egen) valdSaljare = egen;
  if (!valdSaljare || !lag.some((s) => s.id === valdSaljare)) valdSaljare = lag[0].id;

  const oppna = (data.tider[dag] || {})[valdSaljare] || [];
  const bokade = (data.bokat[dag] || {})[valdSaljare] || [];
  const rorbar = data.far_styra || (egen && egen === valdSaljare);
  const standard = !oppna.length || oppna.length === (data.slottar || []).length;

  ruta.innerHTML = topp() +
    (egen ? '' : '<div class="filterrad"><select id="tSaljare" class="valj">' +
      lag.map((s) => '<option value="' + esc(s.id) + '"' +
        (s.id === valdSaljare ? ' selected' : '') + '>' + esc(s.namn) + '</option>').join('') +
      '</select></div>') +
    '<p class="karttips">' +
    (rorbar
      ? 'Tryck på en timme för att öppna eller stänga den. ' +
        (standard ? 'Inget är inlagt för dagen, så hela dagen är öppen.' : '')
      : 'Du kan se tiderna men inte ändra dem.') +
    '</p>' +
    '<div class="tidrutnat">' +
    (data.slottar || []).map((t) => {
      const bokad = bokade.includes(t);
      const oppen = oppna.includes(t);
      return '<button class="tidruta' + (bokad ? ' bokad' : oppen ? ' ledig' : ' stangd') + '"' +
        (rorbar && !bokad ? ' data-tid="' + esc(t) + '"' : ' disabled') + '>' +
        esc(t) + '<span>' + (bokad ? 'Möte' : oppen ? 'Ledig' : 'Stängd') + '</span></button>';
    }).join('') +
    '</div>' +
    (rorbar ? '<div class="listverktyg">' +
      '<button class="knapp-mork" id="tAlla">Öppna hela dagen</button>' +
      '<button class="knapp-mork" id="tInga">Stäng hela dagen</button></div>' : '');

  kopplaTopp();
  if ($('tSaljare')) $('tSaljare').onchange = () => { valdSaljare = $('tSaljare').value; rita(); };
  ruta.querySelectorAll('[data-tid]').forEach((k) => {
    k.onclick = () => vaxla(k.dataset.tid, oppna);
  });
  if ($('tAlla')) $('tAlla').onclick = () => spara(null);
  if ($('tInga')) $('tInga').onclick = () => spara([]);
}

function topp() {
  return '<div class="kal-topp">' +
    '<button class="kal-pil" id="tBak" aria-label="Föregående dag">‹</button>' +
    '<div class="kal-rubrik">' + esc(visaDatum(dag)) + '<span>Tider</span></div>' +
    '<button class="kal-pil" id="tFram" aria-label="Nästa dag">›</button></div>';
}

function kopplaTopp() {
  $('tBak').onclick = () => { dag = plusDagar(-1, dag); rita(); };
  $('tFram').onclick = () => { dag = plusDagar(1, dag); rita(); };
}

function vaxla(tid, oppna) {
  const nya = oppna.includes(tid) ? oppna.filter((t) => t !== tid) : oppna.concat(tid).sort();
  spara(nya);
}

/** `null` betyder "ta bort raderna" — då gäller standarddagen igen. */
async function spara(tider) {
  try {
    await anrop('saljartider-spara', { saljare_id: valdSaljare, datum: dag, tider });
    toast('Tiderna är sparade');
    await rita();
  } catch (e) {
    toast(e.message);
  }
}

/** Vem sidan handlar om just nu, för rubriken. */
export const dagen = () => dag;
