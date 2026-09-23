/**
 * Listvyerna: kommande bokningar i tur och ordning, och månadslistan.
 *
 * Båda visar det servern släpper fram för rollen — mötesbokaren sina egna,
 * besiktaren sina möten, Admin Besiktare och Mötesbokare+ allas. En bokning
 * går att öppna och visar då allt, inklusive hur besiktningen gick.
 */

import { anrop } from './api.js';
import { $, esc, idag, visaDatum, visaTidpunkt, oppnaPanel, stangPanel } from './ui.js';
import { S, kan } from './state.js';

let listTyp = 'aterbesok';
let sok = '';

/* ══ KOMMANDE BOKNINGAR ══ */

/*
 * Allt som är på gång, i tur och ordning. Vad var och en ser avgör servern:
 * mötesbokaren sina egna, besiktaren sina möten, Admin Besiktare och
 * Mötesbokare+ allas. Poängen är att inte missa något — inte att bläddra.
 */
let kommande = [];

export async function ritaLista() {
  const behallare = $('listInnehall');
  if (!kommande.length) behallare.innerHTML = '<div class="tom">Hämtar bokningar…</div>';

  const verktyg = $('listVerktyg');
  if (verktyg) verktyg.hidden = !kan('knacka');

  let data;
  try {
    data = await anrop('bokningar', { fran: idag(), status: 'bokad' });
  } catch (e) {
    behallare.innerHTML = '<div class="tom">Kunde inte hämta bokningar: ' + esc(e.message) + '</div>';
    return;
  }

  kommande = (data.bokningar || []).slice().sort((a, b) =>
    (a.datum || '9999').localeCompare(b.datum || '9999') || (a.tid || '').localeCompare(b.tid || ''));

  if (S.vy === 'lista') $('vySub').textContent = kommande.length + ' kommande bokningar';

  if (!kommande.length) {
    behallare.innerHTML = '<div class="tom">Inga kommande bokningar.</div>';
    return;
  }

  // Gruppera per besiktare när man ser fler än sina egna — annars blandas de.
  const flera = new Set(kommande.map((b) => b.saljare_id)).size > 1;
  let html = '<div class="lista">';

  if (flera) {
    const per = new Map();
    kommande.forEach((b) => {
      const namn = b.saljare || 'Ej tilldelad';
      if (!per.has(namn)) per.set(namn, []);
      per.get(namn).push(b);
    });
    [...per.keys()].sort((a, b) => a.localeCompare(b, 'sv')).forEach((namn) => {
      html += '<div class="rubrik">' + esc(namn) + ' (' + per.get(namn).length + ')</div>';
      html += per.get(namn).map(kortHtml).join('');
    });
  } else {
    let senasteDag = null;
    kommande.forEach((b) => {
      if (b.datum !== senasteDag) {
        senasteDag = b.datum;
        html += '<div class="rubrik">' + esc(b.datum ? visaDatum(b.datum) : 'Utan datum') + '</div>';
      }
      html += kortHtml(b);
    });
  }

  behallare.innerHTML = html + '</div>';
  behallare.querySelectorAll('[data-bok]').forEach((k) => {
    k.onclick = () => visaBokning(k.dataset.bok, kommande);
  });
}

function kortHtml(b) {
  const idagNu = b.datum === idag();
  return '<button class="kort bokrad' + (idagNu ? ' s-aterkom' : '') + '" data-bok="' + esc(b.id) + '">' +
    '<div class="kort-topp"><div>' +
    '<div class="adress">' + esc(visaDatum(b.datum) || '—') + ' kl. ' + esc(b.tid || '—') + '</div>' +
    '<div class="under">' + esc(b.adress || 'Adress saknas') +
    (b.kund ? ' · ' + esc(b.kund) : '') + '</div>' +
    '</div>' + (idagNu ? '<span class="märke m-aterkom">IDAG</span>' : '') + '</div>' +
    '<div class="rad">' +
    (b.telefon ? '<span>' + esc(b.telefon) + '</span>' : '') +
    (b.saljare ? '<span>' + esc(b.saljare) + '</span>' : '') +
    (b.stege ? '<span>🪜 Stege</span>' : '') +
    '</div></button>';
}

export function kopplaLista() {
  /* Sökrutan och flikarna är borta — listan är kort och sorterad av sig själv. */
}

/* ══ MÅNADSLISTAN ══ */

/*
 * Listan står alltid i innevarande månad och börjar om av sig själv när en
 * ny månad börjar. Vad som syns avgör servern efter roll: mötesbokaren sina
 * egna, besiktaren sina möten, Admin Besiktare och Mötesbokare+ allas — de
 * senare kan dessutom växla mellan personer.
 */
let manad = idag().slice(0, 7);
let valdPerson = '';
let personer = [];
let manadsBokningar = [];

const MANADER = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

const forsta = (m) => m + '-01';
const sista = (m) => m + '-' + new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();

function bytManad(steg) {
  const d = new Date(manad + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + steg);
  manad = d.toISOString().slice(0, 7);
  ritaBokningar();
}

export async function ritaBokningar() {
  const behallare = $('bokInnehall');
  if (!manadsBokningar.length) behallare.innerHTML = '<div class="tom">Hämtar bokningar…</div>';

  // Den som ser allas listor får välja vems han tittar på.
  if (kan('se_personal') && !personer.length) {
    try {
      personer = (await anrop('anvandare-lista')).anvandare.filter((a) => a.aktiv) || [];
    } catch (e) { /* utan listan visas allt, som förut */ }
  }

  const bes = personer.find((p) => p.id === valdPerson);
  const somBesiktare = bes && (bes.roll === 'besiktare' || bes.roll === 'saljadmin');

  let data;
  try {
    data = await anrop('bokningar', {
      fran: forsta(manad),
      till: sista(manad),
      bokare_id: valdPerson && !somBesiktare ? valdPerson : undefined,
      saljare_id: valdPerson && somBesiktare ? valdPerson : undefined,
    });
  } catch (e) {
    behallare.innerHTML = '<div class="tom">Kunde inte hämta bokningar: ' + esc(e.message) + '</div>';
    return;
  }

  manadsBokningar = (data.bokningar || []).slice().sort((a, b) =>
    (a.datum || '9999').localeCompare(b.datum || '9999') || (a.tid || '').localeCompare(b.tid || ''));

  if (S.vy === 'bokningar') {
    $('vySub').textContent = manadsBokningar.length + ' bokningar i ' + MANADER[Number(manad.slice(5, 7)) - 1];
  }

  behallare.innerHTML =
    '<div class="kal-topp">' +
    '<button class="kal-pil" id="mBak" aria-label="Föregående månad">‹</button>' +
    '<div class="kal-rubrik">' + esc(MANADER[Number(manad.slice(5, 7)) - 1] + ' ' + manad.slice(0, 4)) +
    '<span>' + manadsBokningar.length + ' bokningar</span></div>' +
    '<button class="kal-pil" id="mFram" aria-label="Nästa månad">›</button></div>' +
    (kan('se_personal') && personer.length
      ? '<div class="filterrad"><select id="mPerson" class="valj">' +
        '<option value="">Alla</option>' +
        personer.map((p) => '<option value="' + esc(p.id) + '"' +
          (p.id === valdPerson ? ' selected' : '') + '>' + esc(p.namn) + '</option>').join('') +
        '</select></div>'
      : '') +
    (manadsBokningar.length ? listHtml() : '<div class="tom">Inga bokningar den här månaden.</div>');

  $('mBak').onclick = () => bytManad(-1);
  $('mFram').onclick = () => bytManad(1);
  if ($('mPerson')) $('mPerson').onchange = () => { valdPerson = $('mPerson').value; ritaBokningar(); };
  behallare.querySelectorAll('[data-bok]').forEach((k) => {
    k.onclick = () => visaBokning(k.dataset.bok, manadsBokningar);
  });
}

function listHtml() {
  const nu = idag();
  let html = '<div class="lista">';
  let senasteDag = null;

  manadsBokningar.forEach((b) => {
    if (b.datum !== senasteDag) {
      senasteDag = b.datum;
      html += '<div class="rubrik">' + esc(b.datum ? visaDatum(b.datum) : 'Utan datum') +
        (b.datum === nu ? ' · idag' : '') + '</div>';
    }
    const utfall = (b.aterkoppling || [])[0];
    html += '<button class="kort bokrad" data-bok="' + esc(b.id) + '">' +
      '<div class="kort-topp"><div>' +
      '<div class="adress">' + esc(b.tid || '—') + ' · ' + esc(b.adress || 'Adress saknas') + '</div>' +
      '<div class="under">' + esc(b.kund || 'Kund saknas') +
      (b.saljare ? ' · ' + esc(b.saljare) : '') + '</div>' +
      '</div><span class="märke m-' + (b.status === 'genomford' ? 'bokat'
        : b.status === 'avbokad' ? 'nej' : 'aterkom') + '">' +
      (b.status === 'genomford' ? 'GENOMFÖRD' : b.status === 'avbokad' ? 'AVBOKAD' : 'BOKAD') +
      '</span></div>' +
      '<div class="rad">' +
      (b.stege ? '<span>🪜 Stege</span>' : '') +
      (utfall ? '<span>' + esc(utfall.utfall_text) + '</span>' : '') +
      (b.bokare ? '<span>Bokad av ' + esc(b.bokare) + '</span>' : '') +
      '</div></button>';
  });
  return html + '</div>';
}

/** Hela bokningen: vad som bokades, av vem, hos vem — och hur det gick. */
function visaBokning(id, lista) {
  const b = (lista || manadsBokningar).find((x) => x.id === id);
  if (!b) return;
  const telefon = (b.telefon || '').replace(/[^\d+]/g, '');

  oppnaPanel('modal',
    '<h2>' + esc(b.adress || 'Bokning') + '</h2>' +
    '<p class="sub">' + esc([visaDatum(b.datum), b.tid && 'kl. ' + b.tid].filter(Boolean).join(' ')) + '</p>' +
    '<div class="bokad-fakta" style="margin-top:14px">' +
    fakta('Kund', b.kund) +
    fakta('Telefon', b.telefon) +
    fakta('Adress', [b.adress, b.postort].filter(Boolean).join(', ')) +
    fakta('Besiktare', b.saljare) +
    fakta('Bokad av', b.bokare) +
    fakta('Status', b.status === 'genomford' ? 'Genomförd'
      : b.status === 'avbokad' ? 'Avbokad' : 'Bokad') +
    fakta('Ta med stege', b.stege ? 'Ja' : 'Nej') +
    (b.kommentar ? fakta('Från bokningen', b.kommentar) : '') +
    '</div>' +
    (telefon ? '<div class="btn-rad"><a class="btn btn-primary" href="tel:' + esc(telefon) + '">Ring kund</a></div>' : '') +

    '<h3>Hur gick besiktningen?</h3>' +
    ((b.aterkoppling || []).length
      ? '<div class="komm-lista">' + b.aterkoppling.map((a) =>
        '<div class="komm utfall"><div class="komm-topp"><b>' + esc(a.utfall_text) + '</b>' +
        (a.belopp ? ' · ' + esc(String(a.belopp)) + ' kr' : '') +
        ' · ' + esc(a.forfattare || 'Okänd') + ' · ' + esc(visaTidpunkt(a.skapad)) + '</div>' +
        esc(a.text || '') + '</div>').join('') + '</div>'
      : '<p class="sub">' + (b.status === 'genomford'
        ? 'Ingen återkoppling lämnad.'
        : 'Mötet är inte genomfört än.') + '</p>') +
    '<div class="btn-rad"><button class="btn btn-ghost" id="bkStang">Stäng</button></div>');

  $('bkStang').onclick = () => stangPanel('modal');
}

const fakta = (etikett, varde) => (varde
  ? '<div class="fakta-rad"><span>' + esc(etikett) + '</span><b>' + esc(String(varde)) + '</b></div>' : '');

export function kopplaBokningar() {
  manad = idag().slice(0, 7);
}
