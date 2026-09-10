/**
 * Bokningskalendern — månadsvy, dagsvy och bokning.
 *
 * Kalendern har inget rutnät av timmar. En tid finns för att en besiktare
 * lagt in den, och under varje tid står de besiktare som har den, lediga
 * eller bokade var för sig. Allt kommer från servern, så appen erbjuder
 * aldrig en tid som ändå skulle nekas.
 *
 * Hämtas om när vyn öppnas och var 20:e sekund medan den syns, för att två
 * mötesbokare ska se samma lediga tider.
 */

import { anrop, ApiFel } from './api.js';
import { $, esc, toast, oppnaPanel, stangPanel, idag, plusDagar, visaDatum } from './ui.js';
import { S, kan, dataAndrad } from './state.js';

/** Används tills servern svarat; det är serverns värde som gäller. */
export const SLOT_MINUTER = 60;

const POLL_MS = 20000;
const DAGNAMN = ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'];
const MANADER = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

let inst = { tidigast: '06:00', senast: '22:00', steg: 30, langd: SLOT_MINUTER };
let bokningar = [];
let perDag = {};
let ledigaPerDag = {};
let manad = idag().slice(0, 7);
let valdDag = null;
let krockad = null;      // tid som just visade sig vara upptagen
let pollTimer = null;
let saljare = [];        // besiktarna möten bokas på
let tider = [];          // { datum, tid, saljare_id, saljare } — det som faktiskt lagts in
let bokare = [];         // mötesbokare, för den som bokar åt andra

/* ── Datumhjälp ── */

const dagIManad = (m, d) => m + '-' + String(d).padStart(2, '0');
const antalDagar = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
/** Veckodag 0–6 (söndag = 0), uträknat utan tidszonsberoende. */
const veckodag = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
/* Helger är inte längre stängda: det är besiktaren som avgör när han jobbar. */

function bytManad(steg) {
  const d = new Date(manad + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + steg);
  manad = d.toISOString().slice(0, 7);
  valdDag = null;
  hamta();
}

/* ── Hämtning ── */

async function hamta(tyst) {
  const fran = valdDag || manad + '-01';
  const till = valdDag || dagIManad(manad, antalDagar(manad));
  try {
    const data = await anrop('kalender', { fran, till });
    inst = data.installningar || inst;
    bokningar = data.bokningar || [];
    perDag = data.per_dag || {};
    ledigaPerDag = data.lediga_per_dag || {};
    saljare = data.saljare || [];
    tider = data.tider || [];
    rita();
  } catch (e) {
    if (!tyst) $('kalenderInnehall').innerHTML =
      '<div class="tom">Kunde inte hämta kalendern: ' + esc(e.message) + '</div>';
  }
}

/** Kalendern ska visa samma sak för alla — hämta om medan vyn är öppen. */
export function starta() {
  hamta();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) hamta(true); }, POLL_MS);
  // Den som ser alla bokningar får också boka i någon annan bokares namn.
  if (kan('allt_bokat') && !bokare.length) {
    anrop('anvandare-lista')
      .then((d) => { bokare = (d.anvandare || []).filter((a) => a.roll === 'saljare' || a.roll === 'bokare_plus'); })
      .catch(() => {});
  }
}

export function stoppa() {
  clearInterval(pollTimer);
  pollTimer = null;
}

/* ── Månadsvy ── */

/**
 * Månadsvyn är en lista, inte ett rutnät. På en telefon är sju smala
 * kolumner med mest tomma rutor svårläst — och en dag utan vare sig
 * bokningar eller lediga tider är inget man vill trycka på.
 *
 * Här visas bara dagar som har något: "mån 17 juni · 3 bokade · 2 lediga".
 */
function manadsHtml() {
  const nu = idag();
  const dagar = new Set([...Object.keys(perDag), ...Object.keys(ledigaPerDag)]);
  const rader = [...dagar].filter((d) => d.startsWith(manad)).sort();

  const rubrik = MANADER[Number(manad.slice(5, 7)) - 1] + ' ' + manad.slice(0, 4);
  const bokade = Object.values(perDag).reduce((a, b) => a + b, 0);
  const fria = Object.values(ledigaPerDag).reduce((a, b) => a + b, 0);

  return '<div class="kal-topp">' +
    '<button class="kal-pil" id="kalBak" aria-label="Föregående månad">‹</button>' +
    '<div class="kal-rubrik">' + esc(rubrik) +
    '<span>' + bokade + ' bokade · ' + fria + ' lediga</span></div>' +
    '<button class="kal-pil" id="kalFram" aria-label="Nästa månad">›</button></div>' +
    (rader.length
      ? '<div class="dagrader">' + rader.map((dat) => {
        const antal = perDag[dat] || 0;
        const lediga = ledigaPerDag[dat] || 0;
        return '<button class="dagrad' + (dat === nu ? ' idag' : '') +
          (dat < nu ? ' passerad' : '') + '" data-dag="' + esc(dat) + '">' +
          '<span class="dagrad-dag"><b>' + esc(kortDatum(dat)) + '</b>' +
          '<span>' + DAGNAMN[(veckodag(dat) + 6) % 7] + '</span></span>' +
          '<span class="dagrad-tal">' +
          (antal ? '<span class="dagrad-bokade">' + antal + ' bokade</span>' : '') +
          (lediga ? '<span class="dagrad-lediga">' + lediga + ' lediga</span>' : '') +
          '</span><span class="dagrad-pil">›</span></button>';
      }).join('') + '</div>'
      : '<div class="tom">Inga bokningar och inga inlagda tider den här månaden.</div>');
}

/** "17/6" — kort nog för en rad på en telefon. */
const kortDatum = (d) => Number(d.slice(8, 10)) + '/' + Number(d.slice(5, 7));

/**
 * Dagsvyn. Bara tider som någon besiktare faktiskt lagt in finns — en dag
 * ingen fyllt är tom, och timmarna däremellan visas inte alls.
 *
 * Under varje tid står besiktarna som har den, med ledig eller bokad var för
 * sig: att Karl är bokad 16:00 säger ingenting om Hugos 16:00.
 */
function dagsHtml() {
  const dat = valdDag;
  const rubrik = visaDatum(dat);
  const bokDag = bokningar.filter((b) => b.datum === dat);
  const inlagda = tider.filter((t) => t.datum === dat);

  // Varje tid som finns: inlagd av någon, eller upptagen av ett möte.
  const tidsrader = new Map();
  const raden = (tid) => {
    if (!tidsrader.has(tid)) tidsrader.set(tid, new Map());
    return tidsrader.get(tid);
  };
  inlagda.forEach((t) => {
    raden(t.tid).set(t.saljare_id, { id: t.saljare_id, namn: t.saljare, bokningar: [] });
  });
  bokDag.forEach((b) => {
    if (!b.tid) return;
    const rad = raden(b.tid);
    const id = b.saljare_id || '';
    if (!rad.has(id)) {
      rad.set(id, { id, namn: b.saljare || 'Ej tilldelad', bokningar: [] });
    }
    rad.get(id).bokningar.push(b);
  });

  if (!tidsrader.size) {
    return dagsTopp(rubrik) +
      '<div class="tom">Ingen besiktare har lagt in någon tid den här dagen.' +
      (kan('styr_tider') || kan('eget_schema')
        ? '<br>Lägg in tider under Bokningar → ' +
          (kan('styr_tider') ? 'Besiktarnas tider' : 'Mina tider') + '.'
        : '') + '</div>';
  }

  const rader = [...tidsrader.keys()].sort().map((tid) => {
    const personer = [...tidsrader.get(tid).values()]
      .sort((a, b) => (a.namn || '').localeCompare(b.namn || '', 'sv'));
    const lediga = personer.filter((p) => !p.bokningar.length).length;

    return '<div class="tidblock' + (krockad === tid ? ' krock' : '') + '">' +
      '<div class="tidblock-topp"><b>' + esc(tid) + '</b>' +
      '<span>' + (lediga ? lediga + ' ledig' + (lediga > 1 ? 'a' : '') : 'alla bokade') +
      ' av ' + personer.length + '</span></div>' +
      personer.map((p) => (p.bokningar.length ? bokadRuta(tid, p) : ledigRuta(tid, p))).join('') +
      '</div>';
  }).join('');

  return dagsTopp(rubrik) + '<div class="slotlista">' + rader + '</div>';
}

/** En besiktare som är bokad på tiden. */
function bokadRuta(tid, p) {
  return '<div class="slot bokad' + (p.bokningar.length > 1 ? ' dubbel' : '') +
    '" data-tid="' + esc(tid) + '" data-saljare="' + esc(p.id) + '">' +
    '<span class="slot-namn">' + esc(p.namn) + '</span>' +
    '<span class="slot-innehall">' +
    '<span class="slot-etikett">BOKAD' +
    (p.bokningar.length > 1 ? ' · ' + p.bokningar.length + ' PÅ SAMMA TID' : '') + '</span>' +
    p.bokningar.map((b) => '<span class="slot-bokning"><b>' +
      esc(b.min ? (b.kund || 'Bokad') : 'Bokad tid') + '</b>' +
      (b.adress ? '<span>' + esc(b.adress) + '</span>' : '') +
      (b.telefon ? '<span>' + esc(b.telefon) + '</span>' : '') +
      '<span class="slot-saljare">Bokad av ' + esc(b.bokare || '—') + '</span>' +
      (b.anvandare_id === S.anvandare.id || kan('allt_bokat')
        ? '<button class="slot-avboka" data-avboka="' + esc(b.id) + '">Avboka</button>' : '') +
      '</span>').join('') +
    '</span></div>';
}

/** En besiktare som är ledig på tiden. */
function ledigRuta(tid, p) {
  const inre = '<span class="slot-namn">' + esc(p.namn) + '</span>' +
    '<span class="slot-innehall"><span class="slot-etikett">LEDIG</span></span>';
  if (!kan('boka')) return '<div class="slot ledig">' + inre + '</div>';
  return '<button class="slot ledig" data-boka="' + esc(tid) + '" data-saljare="' + esc(p.id) + '">' +
    inre + '<span class="slot-plus">+</span></button>';
}

function dagsTopp(rubrik) {
  return '<div class="kal-topp">' +
    '<button class="kal-pil" id="kalBak" aria-label="Föregående dag">‹</button>' +
    '<div class="kal-rubrik">' + esc(rubrik) +
    '<span>' + (perDag[valdDag] || 0) + ' bokade tider</span></div>' +
    '<button class="kal-pil" id="kalFram" aria-label="Nästa dag">›</button></div>' +
    '<div class="listverktyg"><button class="knapp-mork" id="kalManad">Tillbaka till månaden</button></div>';
}

/* ── Rendering och händelser ── */

export function rita() {
  const ruta = $('kalenderInnehall');
  if (!ruta) return;
  ruta.innerHTML = valdDag ? dagsHtml() : manadsHtml();

  // En hämtning kan bli klar efter att man bytt vy — skriv då inte över
  // den vyns underrubrik.
  if (S.vy === 'bokningar') {
    $('vySub').textContent = valdDag
      ? (perDag[valdDag] || 0) + ' bokade tider'
      : Object.values(perDag).reduce((a, b) => a + b, 0) + ' bokningar i månaden';
  }

  const steg = valdDag ? 1 : 0;
  $('kalBak').onclick = () => { if (steg) { valdDag = plusDagar(-1, valdDag); hamta(); } else bytManad(-1); };
  $('kalFram').onclick = () => { if (steg) { valdDag = plusDagar(1, valdDag); hamta(); } else bytManad(1); };
  if ($('kalManad')) $('kalManad').onclick = () => { valdDag = null; krockad = null; hamta(); };

  ruta.querySelectorAll('[data-dag]').forEach((k) => {
    k.onclick = () => { valdDag = k.dataset.dag; krockad = null; hamta(); };
  });
  ruta.querySelectorAll('[data-boka]').forEach((k) => {
    k.onclick = () => visaBokningsformular(k.dataset.boka, k.dataset.saljare);
  });
  ruta.querySelectorAll('[data-avboka]').forEach((k) => {
    k.onclick = () => avboka(k.dataset.avboka);
  });
}

/* ── Boka och avboka ── */

function visaBokningsformular(tid, saljareId) {
  // Besiktarna som lagt in just den tiden och inte redan är bokade på den.
  // Mötet läggs på en av dem, och det är mötesbokaren som väljer vem.
  const lediga = tider
    .filter((t) => t.datum === valdDag && t.tid === tid &&
      !bokningar.some((b) => b.datum === valdDag && b.tid === tid && b.saljare_id === t.saljare_id))
    .map((t) => ({ id: t.saljare_id, namn: t.saljare }))
    .sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));

  const saljarVal = lediga.length > 1
    ? '<div class="field"><label for="kSaljare">Välj besiktare</label><select id="kSaljare">' +
      lediga.map((s) => '<option value="' + esc(s.id) + '"' +
        (s.id === saljareId ? ' selected' : '') + '>' + esc(s.namn) + ' – ledig</option>').join('') +
      '</select></div>'
    : lediga.length === 1
      ? '<input type="hidden" id="kSaljare" value="' + esc(lediga[0].id) + '">'
      : '';

  const vald = lediga.find((s) => s.id === saljareId) || lediga[0];
  const bokarVal = kan('allt_bokat') && bokare.length > 1
    ? '<div class="field"><label for="kBokare">Bokad av</label><select id="kBokare">' +
      bokare.map((s) => '<option value="' + esc(s.id) + '"' +
        (s.id === S.anvandare.id ? ' selected' : '') + '>' + esc(s.namn) + '</option>').join('') +
      '</select></div>'
    : '';

  oppnaPanel('modal',
    '<h2>' + esc(visaDatum(valdDag)) + ' kl. ' + esc(tid) + '</h2>' +
    '<p class="sub">' +
    (lediga.length > 1
      ? esc(String(lediga.length)) + ' besiktare är lediga den tiden — välj vem som tar mötet.'
      : vald ? esc(vald.namn) + ' tar mötet.' : 'Ingen besiktare är ledig den tiden.') +
    '</p>' +
    '<div class="rad2" style="margin-top:14px">' +
    '<div class="field"><label for="kFornamn">Förnamn</label><input id="kFornamn" type="text" autocomplete="given-name"></div>' +
    '<div class="field"><label for="kEfternamn">Efternamn</label><input id="kEfternamn" type="text" autocomplete="family-name"></div>' +
    '</div>' +
    '<div class="field"><label for="kAdress">Adress</label>' +
    '<input id="kAdress" type="text" placeholder="Törngatan 16, Örebro" autocomplete="off"></div>' +
    '<div class="field"><label for="kTelefon">Mobilnummer</label>' +
    '<input id="kTelefon" type="tel" inputmode="tel" placeholder="070-123 45 67"></div>' +
    saljarVal + bokarVal +
    '<div class="field"><label for="kKomm">Anteckning</label>' +
    '<textarea id="kKomm" placeholder="T.ex. tegeltak, mossa på norrsidan"></textarea></div>' +
    '<div class="err" id="kFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="kAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="kSpara">Boka tiden</button></div>');

  $('kAvbryt').onclick = () => stangPanel('modal');
  $('kSpara').onclick = async () => {
    const fornamn = $('kFornamn').value.trim();
    const telefon = $('kTelefon').value.trim();
    const adress = $('kAdress').value.trim();
    if (!fornamn || !telefon) { $('kFel').textContent = 'Förnamn och mobilnummer krävs.'; return; }
    if (!adress) { $('kFel').textContent = 'Fyll i adressen med husnummer.'; return; }

    $('kSpara').textContent = 'Bokar…';
    try {
      await anrop('kalender-boka', {
        datum: valdDag,
        tid,
        fornamn,
        efternamn: $('kEfternamn').value.trim(),
        telefon,
        adress,
        kommentar: $('kKomm').value.trim(),
        saljare_id: $('kSaljare') ? $('kSaljare').value : undefined,
        bokare_id: $('kBokare') ? $('kBokare').value : undefined,
      });
      stangPanel('modal');
      toast('Tiden är bokad ✓');
      krockad = null;
      await hamta();
      dataAndrad();
    } catch (e) {
      $('kSpara').textContent = 'Boka tiden';
      $('kFel').textContent = e.message;
      // Någon annan hann före: visa rutan som upptagen direkt.
      if (e instanceof ApiFel && e.status === 409) {
        krockad = tid;
        await hamta();
      }
    }
  };
}

async function avboka(id) {
  const b = bokningar.find((x) => x.id === id);
  if (!confirm('Avboka ' + (b ? (b.kund || b.adress || 'tiden') : 'tiden') + '?')) return;
  try {
    await anrop('bokning-status', { id, status: 'avbokad' });
    toast('Tiden är avbokad — rutan är ledig igen');
    await hamta();
    dataAndrad();
  } catch (e) {
    toast('Kunde inte avboka: ' + e.message);
  }
}

/* ── Lediga tider för dörrpanelen ── */

/**
 * Vilka tider är lediga en viss dag, och vilka besiktare har dem?
 * Används när ett knack blir en bokning, så att mötesbokaren väljer tid och
 * besiktare direkt vid dörren — ur samma tider som kalendern visar.
 */
export async function ledigaTider(dat) {
  const data = await anrop('kalender', { fran: dat, till: dat });
  inst = data.installningar || inst;
  const bokade = (data.bokningar || []).filter((b) => b.datum === dat);

  // En tid är ledig så länge någon besiktare har lagt in den och inte är
  // bokad på den. Vem som tar mötet väljs sedan i formuläret.
  const fria = {};
  (data.tider || []).filter((t) => t.datum === dat).forEach((t) => {
    const upptagen = bokade.some((b) => b.tid === t.tid && b.saljare_id === t.saljare_id);
    if (upptagen) return;
    if (!fria[t.tid]) fria[t.tid] = [];
    fria[t.tid].push({ id: t.saljare_id, namn: t.saljare });
  });
  Object.values(fria).forEach((lista) => lista.sort((a, b) => a.namn.localeCompare(b.namn, 'sv')));

  return {
    tider: Object.keys(fria).sort(),
    saljarePer: fria,
    saljare: data.saljare || [],
  };
}
