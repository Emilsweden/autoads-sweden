/**
 * Besiktarnas tider — vilka klockslag var och en faktiskt tar möten.
 *
 * En dag är tom tills någon lägger in en tid. Det som står här är hela
 * kalendern: mötesbokarna kan bara boka tider som finns här. Besiktaren styr
 * sin egen dag; Admin Besiktare och Mötesbokare+ styr allas.
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
      '<div class="tom">Ingen besiktare är upplagd än. Ett konto läggs upp under ' +
      'Admin → Användare med rollen Besiktare.</div>';
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

  ruta.innerHTML = topp() +
    (egen ? '' : '<div class="filterrad"><select id="tSaljare" class="valj">' +
      lag.map((s) => '<option value="' + esc(s.id) + '"' +
        (s.id === valdSaljare ? ' selected' : '') + '>' + esc(s.namn) + '</option>').join('') +
      '</select></div>') +
    '<p class="karttips">' +
    (rorbar
      ? 'Tryck på ett klockslag för att lägga till eller ta bort det. ' +
        (oppna.length
          ? oppna.length + ' tid' + (oppna.length > 1 ? 'er' : '') + ' inlagda — det är dessa ' +
            'mötesbokarna kan boka.'
          : 'Dagen är tom: ingen kan boka något förrän du lagt in en tid.')
      : 'Du kan se tiderna men inte ändra dem.') +
    '</p>' +
    '<div class="tidrutnat">' +
    (data.mojliga_tider || []).map((t) => {
      const bokad = bokade.includes(t);
      const oppen = oppna.includes(t);
      return '<button class="tidruta' + (bokad ? ' bokad' : oppen ? ' ledig' : ' stangd') + '"' +
        (rorbar && !bokad ? ' data-tid="' + esc(t) + '"' : ' disabled') + '>' +
        esc(t) + '<span>' + (bokad ? 'Möte' : oppen ? 'Ledig' : '—') + '</span></button>';
    }).join('') +
    '</div>' +
    (rorbar ? '<div class="listverktyg">' +
      '<button class="knapp-mork" id="tKontor">Lägg in 08–17</button>' +
      '<button class="knapp-mork" id="tInga">Töm dagen</button></div>' : '');

  kopplaTopp();
  if ($('tSaljare')) $('tSaljare').onchange = () => { valdSaljare = $('tSaljare').value; rita(); };
  ruta.querySelectorAll('[data-tid]').forEach((k) => {
    k.onclick = () => vaxla(k.dataset.tid, oppna);
  });
  // En vanlig arbetsdag med ett tryck, i stället för nio.
  if ($('tKontor')) {
    $('tKontor').onclick = () => spara(
      (data.mojliga_tider || []).filter((t) => t >= '08:00' && t <= '17:00' && t.endsWith(':00')));
  }
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

/** Hela dagens tider skickas på en gång; en tom lista tömmer dagen. */
async function spara(tider) {
  try {
    await anrop('saljartider-spara', { saljare_id: valdSaljare, datum: dag, tider });
    toast(tider.length ? 'Tiderna är sparade' : 'Dagen är tömd');
    await rita();
  } catch (e) {
    toast(e.message);
  }
}

/** Vem sidan handlar om just nu, för rubriken. */
export const dagen = () => dag;
