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
import { S, arRoll, dataAndrad } from './state.js';

/** Används tills servern svarat; det är serverns värde som gäller. */
export const SLOT_MINUTER = 30;

const POLL_MS = 20000;
const DAGNAMN = ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'];
const MANADER = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

let inst = { oppnar: '08:00', stanger: '20:00', slot: SLOT_MINUTER, dagar: [1, 2, 3, 4, 5] };
let slottar = [];
let bokningar = [];
let perDag = {};
let manad = idag().slice(0, 7);
let valdDag = null;
let krockad = null;      // tid som just visade sig vara upptagen
let pollTimer = null;
let saljare = [];

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
  if (arRoll('teamleader') && !saljare.length) {
    anrop('anvandare-lista').then((d) => { saljare = d.anvandare || []; }).catch(() => {});
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

function dagsHtml() {
  const dat = valdDag;
  const tagna = new Map(bokningar.filter((b) => b.datum === dat).map((b) => [b.tid, b]));
  const rubrik = visaDatum(dat);

  if (arHelg(dat)) {
    return dagsTopp(rubrik) +
      '<div class="tom">Helg — inga bokningsbara tider.<br>Öppettiderna är ' +
      esc(inst.oppnar) + '–' + esc(inst.stanger) + ', måndag till fredag.</div>';
  }

  const rader = slottar.map((tid) => {
    const b = tagna.get(tid);
    if (b) {
      // Rutan man just försökte boka markeras röd även när den nu är tagen,
      // så att man ser vilken tid som gick förlorad.
      return '<div class="slot bokad' + (krockad === tid ? ' krock' : '') + '" data-tid="' + esc(tid) + '">' +
        '<span class="slot-tid">' + esc(tid) + '</span>' +
        '<span class="slot-innehall"><b>' + esc(b.kund || 'Bokad') +
        (krockad === tid ? ' — upptogs precis' : '') + '</b>' +
        (b.adress ? '<span>' + esc(b.adress) + '</span>' : '') +
        (b.telefon ? '<span>' + esc(b.telefon) + '</span>' : '') +
        '<span class="slot-saljare">' + esc(b.saljare || '') + '</span></span>' +
        // Egna bokningar avbokar man själv; andras kräver teamleader.
        (b.anvandare_id === S.anvandare.id || arRoll('teamleader')
          ? '<button class="slot-avboka" data-avboka="' + esc(b.id) + '">Avboka</button>' : '') +
        '</div>';
    }
    return '<button class="slot ledig' + (krockad === tid ? ' krock' : '') + '" data-boka="' + esc(tid) + '">' +
      '<span class="slot-tid">' + esc(tid) + '</span>' +
      '<span class="slot-innehall">' + (krockad === tid ? 'Upptagen — välj en annan' : 'Ledig') + '</span>' +
      '<span class="slot-plus">+</span></button>';
  }).join('');

  return dagsTopp(rubrik) +
    '<div class="slotlista">' + rader + '</div>';
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

  $('vySub').textContent = valdDag
    ? (perDag[valdDag] || 0) + ' bokade tider'
    : Object.values(perDag).reduce((a, b) => a + b, 0) + ' bokningar i månaden';

  const steg = valdDag ? 1 : 0;
  $('kalBak').onclick = () => { if (steg) { valdDag = plusDagar(-1, valdDag); hamta(); } else bytManad(-1); };
  $('kalFram').onclick = () => { if (steg) { valdDag = plusDagar(1, valdDag); hamta(); } else bytManad(1); };
  if ($('kalManad')) $('kalManad').onclick = () => { valdDag = null; krockad = null; hamta(); };

  ruta.querySelectorAll('[data-dag]').forEach((k) => {
    k.onclick = () => { valdDag = k.dataset.dag; krockad = null; hamta(); };
  });
  ruta.querySelectorAll('[data-boka]').forEach((k) => {
    k.onclick = () => visaBokningsformular(k.dataset.boka);
  });
  ruta.querySelectorAll('[data-avboka]').forEach((k) => {
    k.onclick = () => avboka(k.dataset.avboka);
  });
}

/* ── Boka och avboka ── */

function visaBokningsformular(tid) {
  const saljarVal = arRoll('teamleader') && saljare.length
    ? '<div class="field"><label for="kSaljare">Säljare</label><select id="kSaljare">' +
      saljare.map((s) => '<option value="' + esc(s.id) + '"' +
        (s.id === S.anvandare.id ? ' selected' : '') + '>' + esc(s.namn) + '</option>').join('') +
      '</select></div>'
    : '';

  oppnaPanel('modal',
    '<h2>' + esc(visaDatum(valdDag)) + ' kl. ' + esc(tid) + '</h2>' +
    '<p class="sub">Bokad besiktning. Tiden reserveras för hela laget så fort du sparar.</p>' +
    '<div class="rad2" style="margin-top:14px">' +
    '<div class="field"><label for="kFornamn">Förnamn</label><input id="kFornamn" type="text" autocomplete="given-name"></div>' +
    '<div class="field"><label for="kEfternamn">Efternamn</label><input id="kEfternamn" type="text" autocomplete="family-name"></div>' +
    '</div>' +
    '<div class="field"><label for="kAdress">Adress</label>' +
    '<input id="kAdress" type="text" placeholder="Törngatan 16, Örebro" autocomplete="off"></div>' +
    '<div class="field"><label for="kTelefon">Mobilnummer</label>' +
    '<input id="kTelefon" type="tel" inputmode="tel" placeholder="070-123 45 67"></div>' +
    saljarVal +
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
  const tagna = new Set((data.bokningar || []).map((b) => b.tid));
  return {
    helg: !(data.installningar || inst).dagar.includes(veckodag(dat)),
    tider: (data.slottar || []).filter((t) => !tagna.has(t)),
    oppnar: (data.installningar || inst).oppnar,
    stanger: (data.installningar || inst).stanger,
  };
}
