/**
 * Besiktarnas scheman — en månadskalender per besiktare.
 *
 * Månaden visar per dag hur många tider som är inlagda, om det finns möten
 * och om något är blockerat. Ett tryck på en dag visar dagens halvtimmar
 * inom besiktarens arbetstid, och där läggs tider till, tas bort eller
 * blockeras. En dag är tom tills någon lägger in en tid — det är bara de
 * inlagda tiderna mötesbokarna kan boka.
 *
 * Besiktaren styr sitt eget schema; Admin Besiktare och Mötesbokare+ väljer
 * vilken besiktare de tittar på. Vem som får göra vad avgör servern.
 */

import { anrop } from './api.js';
import { $, esc, toast, idag, plusDagar, visaDatum } from './ui.js';

const MANADER = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const VECKODAGAR = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];

let manad = idag().slice(0, 7);
let dag = null;              // vald dag, eller null för månaden
let data = null;
let valdSaljare = '';
let lage = 'lagg_till';      // vad ett tryck på en tid gör: lagg_till | blockera
let orsak = '';
let forAlla = false;         // blockeringen gäller alla besiktare
let kedja = Promise.resolve();   // ändringarna skickas en i taget, i tryckordning

const forstaDag = (m) => m + '-01';
const sistaDag = (m) => m + '-' + String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0');
const veckodag = (d) => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;   // måndag = 0

/** Hämtar hela månaden och ritar det som är valt: månaden eller en dag. */
export async function rita() {
  const ruta = $('tiderInnehall');
  if (!ruta) return;
  if (!data) ruta.innerHTML = '<div class="tom">Hämtar tider…</div>';
  try {
    data = await anrop('saljartider', { fran: forstaDag(manad), till: sistaDag(manad) });
  } catch (e) {
    ruta.innerHTML = '<div class="tom">Kunde inte hämta tiderna: ' + esc(e.message) + '</div>';
    return;
  }
  ritaOm();
}

function ritaOm() {
  const ruta = $('tiderInnehall');
  if (!ruta || !data) return;
  const lag = data.saljare || [];
  if (!lag.length) {
    ruta.innerHTML = '<div class="tom">Ingen besiktare är upplagd än. Ett konto läggs upp under ' +
      'Profil → Admin → Användare med rollen Besiktare.</div>';
    return;
  }
  if (data.eget_schema && !data.far_styra) valdSaljare = data.eget_schema;
  if (!valdSaljare || !lag.some((s) => s.id === valdSaljare)) valdSaljare = lag[0].id;

  ruta.innerHTML = valjare(lag) + (dag ? dagHtml() : manadHtml());
  koppla(ruta);
  // Sidan ritas om när en ändring sparats; beskedet ska stå kvar ändå.
  if (senasteStatus && Date.now() < senasteStatus.till) visaStatus(senasteStatus.text);
}

/** Besiktarväljaren. Bara besiktare — Admin Besiktare har inget schema. */
function valjare(lag) {
  if (lag.length < 2 && !data.far_styra) return '';
  return '<div class="filterrad"><select id="tSaljare" class="valj" aria-label="Besiktare">' +
    lag.map((s) => '<option value="' + esc(s.id) + '"' + (s.id === valdSaljare ? ' selected' : '') + '>' +
      esc(s.namn) + ' · ' + esc(s.arbetstid.fran) + '–' + esc(s.arbetstid.till) + '</option>').join('') +
    '</select></div>';
}

const person = () => (data.saljare || []).find((s) => s.id === valdSaljare) || {};
const iDag = (falt, d) => ((data[falt] || {})[d] || {})[valdSaljare] || [];

/* ── Månaden ── */

function manadHtml() {
  const nu = idag();
  const forsta = forstaDag(manad);
  const antal = +sistaDag(manad).slice(8);
  const tomma = veckodag(forsta);
  const p = person();

  let rutor = '';
  for (let i = 0; i < tomma; i++) rutor += '<span class="mkal-tom"></span>';
  for (let n = 1; n <= antal; n++) {
    const d = manad + '-' + String(n).padStart(2, '0');
    const inlagda = iDag('tider', d).length;
    const moten = iDag('bokat', d).length;
    const block = iDag('blockerade', d).length;
    const lediga = iDag('bokbara', d).length;
    rutor += '<button class="mkal-dag' + (d === nu ? ' idag' : '') + (d < nu ? ' passerad' : '') +
      (inlagda ? ' har-tider' : '') + '" data-dag="' + d + '" aria-label="' + esc(visaDatum(d)) +
      (inlagda ? ', ' + inlagda + ' tider' : '') + (moten ? ', ' + moten + ' möten' : '') + '">' +
      '<b>' + n + '</b>' +
      (inlagda ? '<span class="mkal-antal">' + (lediga ? lediga + ' lediga' : 'fullt') + '</span>' : '') +
      '<span class="mkal-prickar">' +
      (moten ? '<i class="prick-mote" title="Möten"></i>'.repeat(Math.min(moten, 3)) : '') +
      (block ? '<i class="prick-block" title="Blockerat"></i>' : '') +
      '</span></button>';
  }

  return '<div class="kal-topp">' +
    '<button class="kal-pil" id="tBak" aria-label="Föregående månad">‹</button>' +
    '<div class="kal-rubrik">' + esc(MANADER[+manad.slice(5, 7) - 1] + ' ' + manad.slice(0, 4)) +
    '<span>' + esc(p.namn || '') + ' · max ' + esc(String(p.max_per_dag || 3)) + ' möten/dag</span></div>' +
    '<button class="kal-pil" id="tFram" aria-label="Nästa månad">›</button></div>' +
    '<div class="mkal">' + VECKODAGAR.map((v) => '<span class="mkal-vd">' + v + '</span>').join('') + rutor + '</div>' +
    '<p class="karttips">Tryck på en dag för att lägga till eller blockera tider. ' +
    'Siffran är tider som går att boka; prickarna är möten, en röd ring betyder blockerat.</p>';
}

/* ── Dagen ── */

function dagHtml() {
  const p = person();
  const inlagda = iDag('tider', dag);
  const bokade = iDag('bokat', dag);
  const blockerade = iDag('blockerade', dag);
  const fria = iDag('bokbara', dag);
  const mall = ((data.mallar || {})[valdSaljare] || []);
  const passerad = dag < idag();

  const rutor = (p.mojliga_tider || data.mojliga_tider || []).map((t) => {
    const block = blockerade.find((b) => b.tid === t);
    const tillstand = bokade.includes(t) ? ['bokad', 'Möte']
      : block ? ['blockerad', block.orsak || 'Blockerad']
      : fria.includes(t) ? ['ledig', 'Ledig']
      : inlagda.includes(t) ? ['ej-bokbar', passerad ? 'Passerad' : 'Ej bokbar']
      : ['stangd', '—'];
    return '<button class="tidruta ' + tillstand[0] + '" data-tid="' + esc(t) + '"' +
      (tillstand[0] === 'bokad' ? ' disabled' : '') + '>' +
      esc(t) + '<span>' + esc(tillstand[1]) + '</span></button>';
  }).join('');

  return '<div class="kal-topp">' +
    '<button class="kal-pil" id="tBak" aria-label="Föregående dag">‹</button>' +
    '<div class="kal-rubrik">' + esc(visaDatum(dag)) +
    '<span>' + esc(p.namn || '') + ' · ' + bokade.length + ' av ' + esc(String(p.max_per_dag || 3)) + ' möten</span></div>' +
    '<button class="kal-pil" id="tFram" aria-label="Nästa dag">›</button></div>' +
    '<div class="listverktyg"><button class="knapp-mork" id="tManad">Tillbaka till månaden</button></div>' +
    '<div class="lagesval" role="radiogroup" aria-label="Vad ett tryck gör">' +
    '<button class="lage' + (lage === 'lagg_till' ? ' vald' : '') + '" data-lage="lagg_till" role="radio" aria-checked="' +
      (lage === 'lagg_till') + '">Lägg till tider</button>' +
    '<button class="lage' + (lage === 'blockera' ? ' vald' : '') + '" data-lage="blockera" role="radio" aria-checked="' +
      (lage === 'blockera') + '">Blockera tider</button></div>' +
    (lage === 'blockera'
      ? '<div class="field blockorsak"><label for="tOrsak">Orsak (valfritt)</label>' +
        '<input id="tOrsak" type="text" placeholder="T.ex. tandläkare" value="' + esc(orsak) + '"></div>' +
        (data.far_styra ? '<label class="blockalla"><input type="checkbox" id="tAlla"' + (forAlla ? ' checked' : '') +
          '> Blockera för alla besiktare</label>' : '')
      : '') +
    '<p class="karttips">' + (lage === 'blockera'
      ? 'Tryck på en tid för att blockera den — eller på en blockerad för att släppa den.'
      : 'Tryck på en tid för att lägga till den — eller på en inlagd för att ta bort den.') +
    ' Arbetstid ' + esc(p.arbetstid ? p.arbetstid.fran + '–' + p.arbetstid.till : '') +
    '. Minst 3 timmar mellan mötena.</p>' +
    '<div class="tidrutnat">' + rutor + '</div>' +
    '<div class="listverktyg">' +
    (mall.length ? '<button class="knapp-guld" id="tMall">Lägg in ' + esc((p.namn || '').split(' ')[0]) +
      's standardtider</button>' : '') +
    '<button class="knapp-mork" id="tInga">Töm dagen</button></div>' +
    '<div class="listverktyg"><button class="knapp-mork" id="tSparaMall">Spara dagens tider som mall</button></div>' +
    '<div class="sparstatus" id="tStatus" hidden></div>';
}

/* ── Händelser ── */

function koppla(ruta) {
  if ($('tSaljare')) $('tSaljare').onchange = () => { valdSaljare = $('tSaljare').value; ritaOm(); };
  $('tBak').onclick = () => (dag ? bytDag(-1) : bytManad(-1));
  $('tFram').onclick = () => (dag ? bytDag(1) : bytManad(1));
  ruta.querySelectorAll('[data-dag]').forEach((k) => { k.onclick = () => { dag = k.dataset.dag; ritaOm(); }; });
  if ($('tManad')) $('tManad').onclick = () => { dag = null; ritaOm(); };
  ruta.querySelectorAll('[data-lage]').forEach((k) => { k.onclick = () => { lage = k.dataset.lage; ritaOm(); }; });
  if ($('tOrsak')) $('tOrsak').oninput = () => { orsak = $('tOrsak').value; };
  if ($('tAlla')) $('tAlla').onchange = () => { forAlla = $('tAlla').checked; };
  ruta.querySelectorAll('.tidruta[data-tid]').forEach((k) => { k.onclick = () => tryck(k); });

  if ($('tMall')) {
    $('tMall').onclick = () => {
      // Mallen lägger bara till — blockerade och bokade tider rörs inte.
      const upptagna = new Set([...iDag('blockerade', dag).map((b) => b.tid), ...iDag('bokat', dag)]);
      const tider = ((data.mallar || {})[valdSaljare] || []).filter((t) => !upptagna.has(t));
      if (tider.length) skicka('lagg_till', tider, 'Standardtiderna är inlagda ✓');
    };
  }
  if ($('tInga')) {
    $('tInga').onclick = () => {
      const bokade = iDag('bokat', dag);
      const tider = iDag('tider', dag).filter((t) => !bokade.includes(t));
      if (tider.length && confirm('Ta bort dagens ' + tider.length + ' inlagda tider? Möten och blockeringar står kvar.')) {
        skicka('ta_bort', tider, 'Dagen är tömd ✓');
      }
    };
  }
  if ($('tSparaMall')) $('tSparaMall').onclick = sparaMall;
}

function bytManad(steg) {
  const d = new Date(forstaDag(manad) + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + steg);
  manad = d.toISOString().slice(0, 7);
  rita();
}

function bytDag(steg) {
  dag = plusDagar(steg, dag);
  if (dag.slice(0, 7) !== manad) { manad = dag.slice(0, 7); rita(); } else ritaOm();
}

/** Ett tryck på en tid. Rutan ändras direkt; servern får sista ordet. */
function tryck(knapp) {
  const t = knapp.dataset.tid;
  const k = knapp.classList;
  let andring;
  if (lage === 'blockera') andring = k.contains('blockerad') ? 'avblockera' : 'blockera';
  else if (k.contains('blockerad')) andring = 'lagg_till';       // släpp blockeringen och lägg in tiden
  else andring = (k.contains('ledig') || k.contains('ej-bokbar')) ? 'ta_bort' : 'lagg_till';

  k.remove('ledig', 'ej-bokbar', 'stangd', 'blockerad');
  k.add(andring === 'blockera' ? 'blockerad' : andring === 'lagg_till' ? 'ledig' : 'stangd', 'sparar');
  const etikett = knapp.querySelector('span');
  if (etikett) etikett.textContent = andring === 'blockera' ? (orsak || 'Blockerad') : andring === 'lagg_till' ? 'Ledig' : '—';
  skicka(andring, [t]);
}

/**
 * Skickar en ändring. Trycker man på flera tider i rad köas de och går i
 * samma ordning — de rör var sin tid, så ingen skriver över någon annan.
 */
function skicka(andring, tider, klartText) {
  const alla = (andring === 'blockera' || andring === 'avblockera') && forAlla && data.far_styra;
  const saljareId = alla ? 'alla' : valdSaljare;
  const datumet = dag;
  status('Sparar…');
  kedja = kedja.then(async () => {
    try {
      await anrop('saljartid-andra', {
        saljare_id: saljareId, datum: datumet, tider, lage: andring,
        orsak: andring === 'blockera' ? orsak : undefined,
      });
      status(klartText || 'Sparat ✓', 1800);
    } catch (e) {
      // Som toast också: har man hunnit gå tillbaka till månaden finns inte
      // statusraden, och felet får inte försvinna tyst.
      status('Kunde inte spara: ' + e.message, 6000);
      toast('Kunde inte spara ' + tider.join(', ') + ': ' + e.message);
    }
  });
  // När kön är tom hämtas månaden om, så att "Ledig" också betyder bokningsbar.
  const denna = kedja;
  denna.then(() => { if (denna === kedja) rita(); });
}

async function sparaMall() {
  const tider = iDag('tider', dag);
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

let statusTimer = null;
let senasteStatus = null;
function status(text, doljEfter) {
  senasteStatus = { text, till: Date.now() + (doljEfter || 60000) };
  visaStatus(text);
  clearTimeout(statusTimer);
  if (doljEfter) {
    statusTimer = setTimeout(() => {
      senasteStatus = null;
      if ($('tStatus')) $('tStatus').hidden = true;
    }, doljEfter);
  }
}
function visaStatus(text) {
  const el = $('tStatus');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

/** Öppnar schemat på en bestämd besiktare, t.ex. från hans profil. */
export function visaFor(id) {
  valdSaljare = id;
  dag = null;
  data = null;
}

/** Dagen som visas, eller månadens första när månaden visas. */
export const dagen = () => dag || forstaDag(manad);
