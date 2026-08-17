/** Listvyerna: dörrar att jobba med, och bokningskalendern. */

import { anrop } from './api.js';
import {
  $, esc, toast, idag, visaDatum, visaTidpunkt, sedan,
  STATUS_TEXT, RESULTAT_TEXT,
} from './ui.js';
import { S, arRoll, dataAndrad } from './state.js';
import { oppna as oppnaDorr } from './dorr.js';

let listTyp = 'aterbesok';
let sok = '';

/* ══ DÖRRLISTA ══ */

function kortHtml(a) {
  const forsenad = a.aterkom_datum && a.aterkom_datum <= idag();
  return '<button class="kort s-' + esc(a.status) + '" data-id="' + esc(a.id) + '">' +
    '<div class="kort-topp"><div>' +
    '<div class="adress">' + esc(a.adress) + '</div>' +
    (a.senast_namn
      ? '<div class="under">' + esc(a.senast_namn) + ' · ' + esc(sedan(a.senast_tid)) +
        (a.senast_resultat ? ' · ' + esc(RESULTAT_TEXT[a.senast_resultat]) : '') + '</div>'
      : '<div class="under">Aldrig besökt</div>') +
    '</div><span class="märke m-' + esc(a.status) + '">' + esc(STATUS_TEXT[a.status]) + '</span></div>' +
    '<div class="rad">' +
    (a.aterkom_datum
      ? '<span' + (forsenad ? ' style="color:var(--orange);font-weight:600"' : '') + '>Återkom ' +
        esc(visaDatum(a.aterkom_datum)) + (a.aterkom_tid ? ' kl. ' + esc(a.aterkom_tid) : '') + '</span>'
      : '') +
    (a.antal_besok > 1 ? '<span>' + a.antal_besok + ' besök</span>' : '') +
    (a.sparrad_till > Date.now() && a.status !== 'ejbesokt' ? '<span>Fredad</span>' : '') +
    '</div></button>';
}

function gruppera(adresser) {
  const grupper = new Map();
  const nu = idag();
  adresser.forEach((a) => {
    let g;
    if (listTyp === 'aterbesok') {
      g = !a.aterkom_datum ? 'Utan planerad tid'
        : a.aterkom_datum < nu ? 'Försenade'
        : a.aterkom_datum === nu ? 'Idag'
        : visaDatum(a.aterkom_datum);
    } else {
      g = a.gata;
    }
    if (!grupper.has(g)) grupper.set(g, []);
    grupper.get(g).push(a);
  });
  return grupper;
}

export function ritaLista() {
  const nu = idag();
  let urval = S.adresser.filter((a) => !S.valtOmrade || a.omrade_id === S.valtOmrade);

  if (listTyp === 'aterbesok') {
    urval = urval.filter((a) => a.status === 'aterkom' || a.status === 'ejsvar');
    urval.sort((a, b) => (a.aterkom_datum || '9999').localeCompare(b.aterkom_datum || '9999'));
  } else if (listTyp === 'ejbesokt') {
    urval = urval.filter((a) => a.status === 'ejbesokt');
  }

  if (sok) {
    const q = sok.toLowerCase();
    urval = urval.filter((a) => (a.adress + ' ' + (a.senast_namn || '')).toLowerCase().includes(q));
  }

  const behallare = $('listInnehall');
  if (!urval.length) {
    behallare.innerHTML = '<div class="tom">' +
      (listTyp === 'aterbesok' ? 'Inga dörrar att återkomma till.'
        : listTyp === 'ejbesokt' ? 'Alla dörrar i området är bearbetade.'
        : 'Inga dörrar hittades.') + '</div>';
    return;
  }

  const forsenade = urval.filter((a) => a.aterkom_datum && a.aterkom_datum <= nu).length;
  $('vySub').textContent = urval.length + ' dörrar' + (forsenade && listTyp === 'aterbesok' ? ' · ' + forsenade + ' att göra nu' : '');

  let html = '<div class="lista">';
  gruppera(urval).forEach((rader, grupp) => {
    html += '<div class="rubrik">' + esc(grupp) + ' (' + rader.length + ')</div>';
    html += rader.map(kortHtml).join('');
  });
  behallare.innerHTML = html + '</div>';

  behallare.querySelectorAll('.kort').forEach((k) => {
    k.onclick = () => oppnaDorr(k.dataset.id);
  });
}

export function kopplaLista() {
  $('listFlikar').addEventListener('click', (ev) => {
    const b = ev.target.closest('.flik');
    if (!b) return;
    listTyp = b.dataset.lista;
    $('listFlikar').querySelectorAll('.flik').forEach((x) => x.classList.toggle('aktiv', x === b));
    ritaLista();
  });
  $('sokDorr').addEventListener('input', (ev) => { sok = ev.target.value.trim(); ritaLista(); });
}

/* ══ BOKNINGAR ══ */

export async function ritaBokningar() {
  const behallare = $('bokInnehall');
  behallare.innerHTML = '<div class="tom">Hämtar bokningar…</div>';

  let data;
  try {
    data = await anrop('bokningar', {
      fran: $('bokFran').value || undefined,
      till: $('bokTill').value || undefined,
      saljare_id: $('bokSaljare').value || undefined,
    });
  } catch (e) {
    behallare.innerHTML = '<div class="tom">Kunde inte hämta bokningar: ' + esc(e.message) + '</div>';
    return;
  }

  const bokningar = data.bokningar || [];
  $('vySub').textContent = bokningar.length + ' bokningar';
  if (!bokningar.length) {
    behallare.innerHTML = '<div class="tom">Inga bokningar i perioden.</div>';
    return;
  }

  const dagar = new Map();
  bokningar.forEach((b) => {
    const d = b.datum || 'Utan datum';
    if (!dagar.has(d)) dagar.set(d, []);
    dagar.get(d).push(b);
  });

  let html = '<div class="lista">';
  dagar.forEach((rader, dag) => {
    html += '<div class="rubrik">' + esc(dag === 'Utan datum' ? dag : visaDatum(dag)) + ' (' + rader.length + ')</div>';
    rader.forEach((b) => {
      const klar = b.status === 'genomford';
      html += '<div class="kort s-' + (klar ? 'bokat' : b.status === 'avbokad' ? 'nej' : 'ejbesokt') + '">' +
        '<div class="kort-topp"><div>' +
        '<div class="adress">' + esc(b.tid || '--:--') + ' · ' + esc(b.kund || 'Kund') + '</div>' +
        '<div class="under">' + esc(b.adress) + (b.omrade ? ' · ' + esc(b.omrade) : '') + '</div>' +
        '</div><span class="märke m-' + (klar ? 'bokat' : b.status === 'avbokad' ? 'nej' : 'ejbesokt') + '">' +
        esc(klar ? 'Genomförd' : b.status === 'avbokad' ? 'Avbokad' : 'Bokad') + '</span></div>' +
        '<div class="rad"><span>' + esc(b.saljare || '') + '</span>' +
        (b.telefon ? '<span>' + esc(b.telefon) + '</span>' : '') + '</div>' +
        (b.kommentar ? '<div class="under" style="margin-top:8px">' + esc(b.kommentar) + '</div>' : '') +
        '<div class="chips">' +
        (b.telefon ? '<a class="chip" href="tel:' + esc(b.telefon.replace(/[^\d+]/g, '')) + '">Ring</a>' : '') +
        (b.adress ? '<a class="chip" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(b.adress) + '">Karta</a>' : '') +
        (!klar ? '<button class="chip" data-bok="' + esc(b.id) + '" data-status="genomford">Markera genomförd</button>' : '') +
        (b.status !== 'avbokad' ? '<button class="chip" data-bok="' + esc(b.id) + '" data-status="avbokad">Avboka</button>' : '') +
        '</div></div>';
    });
  });
  behallare.innerHTML = html + '</div>';

  behallare.querySelectorAll('[data-bok]').forEach((b) => {
    b.onclick = async () => {
      try {
        await anrop('bokning-status', { id: b.dataset.bok, status: b.dataset.status });
        toast(b.dataset.status === 'genomford' ? 'Markerad som genomförd' : 'Avbokad');
        ritaBokningar();
        dataAndrad();
      } catch (e) { toast('Gick inte: ' + e.message); }
    };
  });
}

export function kopplaBokningar(saljare) {
  $('bokFran').value = idag();
  $('bokTill').value = idag();
  const val = ['<option value="">Alla säljare</option>']
    .concat((saljare || []).map((s) => '<option value="' + esc(s.id) + '">' + esc(s.namn) + '</option>'));
  $('bokSaljare').innerHTML = val.join('');
  if (!arRoll('teamleader')) {
    $('bokSaljare').value = S.anvandare.id;
    $('bokSaljare').disabled = true;
  }
  ['bokFran', 'bokTill', 'bokSaljare'].forEach((id) => {
    $(id).addEventListener('change', ritaBokningar);
  });
}
