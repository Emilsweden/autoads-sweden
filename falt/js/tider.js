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
let sparar = false;          // ett klick i taget — annars blir det dubbletter
let vantande = null;         // tiderna som ska sparas när det pågående är klart

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
  const mall = (data.mallar || {})[valdSaljare] || [];

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
      (mall.length
        ? '<button class="knapp-guld" id="tMall">Mina tider (' + esc(mall.join(', ')) + ')</button>'
        : '') +
      '<button class="knapp-mork" id="tSparaMall">' +
      (mall.length ? 'Ändra min mall' : 'Spara som min mall') + '</button>' +
      '<button class="knapp-mork" id="tInga">Töm dagen</button></div>' : '') +
    '<div class="sparstatus" id="tStatus" hidden></div>';

  kopplaTopp();
  if ($('tSaljare')) $('tSaljare').onchange = () => { valdSaljare = $('tSaljare').value; rita(); };
  ruta.querySelectorAll('[data-tid]').forEach((k) => {
    k.onclick = () => vaxla(k.dataset.tid);
  });
  // Besiktarens egna tider med ett tryck. Alla kör inte 08–17 — en tar tre
  // tak om dagen och lägger 10, 13 och 17.
  if ($('tMall')) $('tMall').onclick = () => spara([...new Set(nuvarandeTider().concat(mall))].sort());
  if ($('tSparaMall')) $('tSparaMall').onclick = () => sparaMall(nuvarandeTider());
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

/**
 * Läser av vad som står på skärmen just nu i stället för hur det såg ut när
 * sidan ritades. Trycker någon på tre tider i snabb följd bygger de på
 * varandra i stället för att skriva över varandra.
 */
function nuvarandeTider() {
  return [...document.querySelectorAll('#tiderInnehall .tidruta')]
    .filter((k) => k.classList.contains('ledig') || k.classList.contains('bokad'))
    .map((k) => k.textContent.slice(0, 5))
    .sort();
}

function vaxla(tid) {
  const nu = nuvarandeTider();
  spara(nu.includes(tid) ? nu.filter((t) => t !== tid) : nu.concat(tid).sort());
}

/**
 * Hela dagens tider skickas på en gång; en tom lista tömmer dagen.
 *
 * Ett anrop i taget. Trycker någon flera gånger medan servern svarar läggs
 * det sista önskade läget på kö och skickas när det pågående är klart — så
 * blir det aldrig två anrop som skriver om varandra, och aldrig dubbletter.
 */
async function spara(tider) {
  if (sparar) { vantande = tider; return; }
  sparar = true;
  status('Sparar…');
  markera(tider);

  try {
    const svar = await anrop('saljartider-spara', { saljare_id: valdSaljare, datum: dag, tider });
    // Serverns svar är facit, inte det vi trodde att vi skickade.
    if (data && data.tider && data.tider[dag]) data.tider[dag][valdSaljare] = svar.tider || [];
    status(tider.length ? 'Sparat ✓' : 'Dagen är tömd ✓', 2000);
  } catch (e) {
    status('Kunde inte spara: ' + e.message, 6000);
    await rita();
    sparar = false;
    return;
  }

  sparar = false;
  if (vantande) {
    const nasta = vantande;
    vantande = null;
    await spara(nasta);
    return;
  }
  await rita();
}

/** Sparar de inlagda tiderna som besiktarens egen mall. */
async function sparaMall(tider) {
  if (!tider.length) { status('Lägg in tiderna först, spara dem sedan som mall.', 5000); return; }
  status('Sparar mallen…');
  try {
    await anrop('snabbtider-spara', { saljare_id: valdSaljare, tider });
    status('Mallen är sparad ✓', 2500);
    await rita();
  } catch (e) {
    status('Kunde inte spara mallen: ' + e.message, 6000);
  }
}

/* Rutorna svarar med en gång, innan servern hunnit. Blir det fel ritas
   sidan om från serverns svar. */
function markera(tider) {
  const ruta = $('tiderInnehall');
  if (!ruta) return;
  ruta.querySelectorAll('.tidruta').forEach((k) => {
    if (k.classList.contains('bokad')) return;
    const pa = tider.includes(k.textContent.slice(0, 5));
    k.classList.toggle('ledig', pa);
    k.classList.toggle('stangd', !pa);
    const etikett = k.querySelector('span');
    if (etikett) etikett.textContent = pa ? 'Ledig' : '—';
  });
}

let statusTimer = null;
function status(text, doljEfter) {
  const el = $('tStatus');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(statusTimer);
  if (doljEfter) statusTimer = setTimeout(() => { el.hidden = true; }, doljEfter);
}

/** Öppnar sidan på en bestämd besiktare, t.ex. från hans profil. */
export function visaFor(id) {
  valdSaljare = id;
  data = null;
}

/** Vem sidan handlar om just nu, för rubriken. */
export const dagen = () => dag;
