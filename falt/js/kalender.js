/**
 * Bokningskalendern — månadsvy, dagsvy med tidsrutor och bokning.
 *
 * Rutorna kommer från servern (öppettider, slotlängd och vilka veckodagar
 * som går att boka) så att appen aldrig erbjuder en tid servern ändå nekar.
 * Kalendern hämtas om när vyn öppnas och var 20:e sekund medan den syns,
 * för att två säljare ska se samma lediga tider.
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

let inst = { oppnar: '08:00', sista: '20:00', slot: SLOT_MINUTER, dagar: [1, 2, 3, 4, 5] };
let slottar = [];
let bokningar = [];
let perDag = {};
let manad = idag().slice(0, 7);
let valdDag = null;
let krockad = null;      // tid som just visade sig vara upptagen
let pollTimer = null;
let saljare = [];        // takbesiktarna möten bokas på
let tider = {};          // datum → säljare-id → öppna tider
let bokare = [];         // mötesbokare, för den som bokar åt andra

/* ── Datumhjälp ── */

const dagIManad = (m, d) => m + '-' + String(d).padStart(2, '0');
const antalDagar = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
/** Veckodag 0–6 (söndag = 0), uträknat utan tidszonsberoende. */
const veckodag = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const arHelg = (d) => !inst.dagar.includes(veckodag(d));
const forstaVeckodag = (m) => (veckodag(m + '-01') + 6) % 7;   // 0 = måndag

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
    slottar = data.slottar || [];
    bokningar = data.bokningar || [];
    perDag = data.per_dag || {};
    saljare = data.saljare || [];
    tider = data.tider || {};
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

function manadsHtml() {
  const dagar = antalDagar(manad);
  const tomma = forstaVeckodag(manad);
  const nu = idag();

  let rutor = '';
  for (let i = 0; i < tomma; i++) rutor += '<div class="kal-tom"></div>';
  for (let d = 1; d <= dagar; d++) {
    const dat = dagIManad(manad, d);
    const antal = perDag[dat] || 0;
    rutor += '<button class="kal-dag' + (arHelg(dat) ? ' helg' : '') +
      (dat === nu ? ' idag' : '') + (dat < nu ? ' passerad' : '') + '" data-dag="' + dat + '">' +
      '<span class="kal-siffra">' + d + '</span>' +
      (antal ? '<span class="kal-antal">' + antal + '</span>' : '') + '</button>';
  }

  const rubrik = MANADER[Number(manad.slice(5, 7)) - 1] + ' ' + manad.slice(0, 4);
  const bokade = Object.values(perDag).reduce((a, b) => a + b, 0);

  return '<div class="kal-topp">' +
    '<button class="kal-pil" id="kalBak" aria-label="Föregående månad">‹</button>' +
    '<div class="kal-rubrik">' + esc(rubrik) + '<span>' + bokade + ' bokningar</span></div>' +
    '<button class="kal-pil" id="kalFram" aria-label="Nästa månad">›</button></div>' +
    '<div class="kal-veckodagar">' + DAGNAMN.map((d) => '<span>' + d + '</span>').join('') + '</div>' +
    '<div class="kal-rutnat">' + rutor + '</div>' +
    '<p class="karttips">Tryck på en dag för att se tiderna. Helger går inte att boka.</p>';
}

/* ── Dagsvy ── */

/**
 * Dagsvyn: en rad per tid och säljare — datum, tid, säljare, status.
 * En säljare som lagt in sina tider syns bara på dem; en som inte rört sin
 * kalender är ledig hela standarddagen, som förut.
 */
function dagsHtml() {
  const dat = valdDag;
  const rubrik = visaDatum(dat);
  const bokDag = bokningar.filter((b) => b.datum === dat);

  if (arHelg(dat)) {
    return dagsTopp(rubrik) +
      '<div class="tom">Helg — inga bokningsbara tider.<br>Tider bokas ' +
      esc(inst.oppnar) + '–' + esc(inst.sista) + ', måndag till fredag.</div>';
  }

  // Laget den här dagen: säljarna, plus "Ej tilldelad" om det finns gamla
  // bokningar utan säljare.
  const lag = saljare.slice();
  if (bokDag.some((b) => !b.saljare_id) || !lag.length) {
    lag.push({ id: '', namn: saljare.length ? 'Ej tilldelad' : 'Besiktning' });
  }

  const oppna = tider[dat] || {};
  const arOppen = (sid, tid) => {
    const lista = oppna[sid];
    // Utan besked från servern gäller standarddagen — annars skulle en
    // långsam hämtning se ut som att ingen är ledig.
    return lista ? lista.includes(tid) : slottar.includes(tid);
  };

  const allaTider = new Set(slottar);
  bokDag.forEach((b) => { if (b.tid) allaTider.add(b.tid); });

  const rader = [...allaTider].sort().map((tid) => {
    const rutor = lag.map((sa) => {
      const pa = bokDag.filter((b) => b.tid === tid && (b.saljare_id || '') === sa.id);
      if (pa.length) return bokadRuta(tid, sa, pa);
      if (!arOppen(sa.id, tid)) return '';
      return ledigRuta(tid, sa);
    }).filter(Boolean).join('');
    return rutor;
  }).join('');

  return dagsTopp(rubrik) +
    (rader
      ? '<div class="slotlista">' + rader + '</div>'
      : '<div class="tom">Ingen säljare har lediga tider den här dagen.</div>');
}

function bokadRuta(tid, sa, pa) {
  return '<div class="slot bokad' + (krockad === tid ? ' krock' : '') +
    (pa.length > 1 ? ' dubbel' : '') + '" data-tid="' + esc(tid) + '" data-saljare="' + esc(sa.id) + '">' +
    '<span class="slot-tid">' + esc(tid) + '</span>' +
    '<span class="slot-innehall">' +
    '<span class="slot-etikett">' + esc(sa.namn) + ' · UPPTAGEN' +
    (pa.length > 1 ? ' · ' + pa.length + ' BOKNINGAR PÅ SAMMA TID' : '') + '</span>' +
    pa.map((b) => '<span class="slot-bokning"><b>' +
      esc(b.min ? (b.kund || 'Bokad') : 'Bokad tid') +
      (krockad === tid && pa.length === 1 ? ' — upptogs precis' : '') + '</b>' +
      (b.adress ? '<span>' + esc(b.adress) + '</span>' : '') +
      (b.telefon ? '<span>' + esc(b.telefon) + '</span>' : '') +
      '<span class="slot-saljare">Bokad av ' + esc(b.bokare || '—') + '</span>' +
      (b.anvandare_id === S.anvandare.id || kan('allt_bokat')
        ? '<button class="slot-avboka" data-avboka="' + esc(b.id) + '">Avboka</button>' : '') +
      '</span>').join('') +
    '</span></div>';
}

function ledigRuta(tid, sa) {
  const bokbar = kan('boka');
  const inre = '<span class="slot-tid">' + esc(tid) + '</span>' +
    '<span class="slot-innehall"><span class="slot-etikett">' + esc(sa.namn) + ' · ' +
    (krockad === tid ? 'UPPTAGEN — VÄLJ EN ANNAN' : 'LEDIG') + '</span></span>';
  if (!bokbar) return '<div class="slot ledig">' + inre + '</div>';
  return '<button class="slot ledig' + (krockad === tid ? ' krock' : '') +
    '" data-boka="' + esc(tid) + '" data-saljare="' + esc(sa.id) + '">' +
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
  // Säljarna som är lediga just den tiden — mötet läggs på en av dem.
  const oppna = (tider[valdDag] || {});
  const lediga = saljare.filter((s) =>
    (oppna[s.id] ? oppna[s.id].includes(tid) : true) &&
    !bokningar.some((b) => b.datum === valdDag && b.tid === tid && b.saljare_id === s.id));

  const saljarVal = lediga.length > 1
    ? '<div class="field"><label for="kSaljare">Säljare</label><select id="kSaljare">' +
      lediga.map((s) => '<option value="' + esc(s.id) + '"' +
        (s.id === saljareId ? ' selected' : '') + '>' + esc(s.namn) + '</option>').join('') +
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
    '<p class="sub">' + (vald ? esc(vald.namn) + ' tar mötet. ' : '') +
    'Tiden reserveras så fort du sparar.</p>' +
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
 * Vilka tider är lediga en viss dag? Används när ett knack blir en bokning,
 * så att säljaren väljer tid direkt vid dörren.
 */
export async function ledigaTider(dat) {
  const data = await anrop('kalender', { fran: dat, till: dat });
  inst = data.installningar || inst;
  const lag = data.saljare || [];
  const oppna = (data.tider || {})[dat] || {};
  const bokade = (data.bokningar || []).filter((b) => b.datum === dat);

  // En tid är ledig så länge någon säljare är ledig då. Vilken säljare det
  // blir avgörs i formuläret, av samma lista.
  const fria = {};
  (data.slottar || []).forEach((t) => {
    const kan = lag.filter((s) =>
      (oppna[s.id] ? oppna[s.id].includes(t) : true) &&
      !bokade.some((b) => b.tid === t && b.saljare_id === s.id));
    if (lag.length ? kan.length : !bokade.some((b) => b.tid === t)) fria[t] = kan;
  });

  return {
    helg: !(data.installningar || inst).dagar.includes(veckodag(dat)),
    tider: Object.keys(fria).sort(),
    saljarePer: fria,
    saljare: lag,
    oppnar: (data.installningar || inst).oppnar,
    sista: (data.installningar || inst).sista,
  };
}
