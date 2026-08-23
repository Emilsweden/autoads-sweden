/**
 * Tolkning av fältanteckningar: den text säljaren skriver i mobilen under
 * dagen ("Törngatan / 16, nej / 22, ej svar") görs om till dörrar med utfall.
 *
 * Tolkningen visas alltid för granskning innan något sparas — den gissar,
 * och en gissning om en kund ska inte hamna i registret oläst.
 */

import { anrop } from './api.js';
import { $, esc, toast, oppnaPanel, stangPanel, RESULTAT_TEXT } from './ui.js';
import { S, dataAndrad } from './state.js';

/* Ord som beskriver ett utfall. Ordningen avgör: det som prövas först vinner. */
const UTFALL = [
  ['ejsvar', ['ej svar', 'inge svar', 'inget svar', 'inga svar', 'inte svar', 'ej hemma',
    'inte hemma', 'ingen hemma', 'ej anträffad']],
  ['bokat', ['bokat', 'bokad', 'bokning', 'bok']],
  ['aterkom', ['komma tillbaka', 'kommer tillbaka', 'återkom', 'aterkom', 'ska kolla',
    'kolla med', 'ska tänka', 'tänka på', 'ska prata', 'prata med', 'ska kika', 'kika på',
    'ska ge till', 'lapp', 'papper', 'broschyr', 'ringa', 'höra av']],
  ['nej', ['nej', 'tackar nej', 'inte intresserad', 'ointresserad', 'ej intresserad',
    'nytt tak', 'nya tak', 'ny tak', 'nytt', 'bytt', 'beställt', 'besiktad', 'besiktigad',
    'besiktning gjord', 'äger inte', 'ager inte', 'ska sälja', 'ska salja', 'säljer huset',
    'ska flytta', 'flyttar']],
];

/** Vilket utfall beskriver texten? Null när inget ord känns igen. */
export function tolkaUtfall(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  for (const [resultat, ord] of UTFALL) {
    if (ord.some((o) => t.includes(' ' + o) || t.includes(o + ' '))) return resultat;
  }
  return null;
}

/* "Hus 12" och "nr 12" är samma sak som "12" — orden är inget gatunamn. */
const BRUS = /^(hus|nr|no|nummer|adress)$/i;

function arGatunamn(rad) {
  if (/\d/.test(rad)) return false;
  const rensad = rad.replace(/[.,:;!?]/g, ' ').trim();
  if (rensad.length < 3) return false;
  // "Resten nej" och "Gula första huset, ej svar" är anteckningar, inte gator.
  return !tolkaUtfall(rensad) && rensad.split(/\s+/).length <= 4;
}

/**
 * Delar upp anteckningarna i dörrar.
 * Returnerar { dorrar, otolkade } där varje dörr har gata, nummer, resultat
 * och kommentar, och otolkade är raderna som inte gick att förstå.
 */
export function tolkaAnteckningar(text, postort) {
  const dorrar = [];
  const otolkade = [];
  let gata = '';

  String(text || '').split(/\r?\n/).forEach((original) => {
    const rad = original.trim().replace(/\s+/g, ' ');
    if (!rad) return;

    if (arGatunamn(rad)) { gata = rad.replace(/[.,:;]+$/, '').trim(); return; }
    if (!/\d/.test(rad)) { otolkade.push(original.trim()); return; }

    // Texten före första siffran är ett gatunamn — utom när det bara är "Hus".
    const delat = rad.match(/^([^\d]*?)\s*(\d.*)$/);
    if (!delat) { otolkade.push(original.trim()); return; }
    const inledning = delat[1].replace(/[.,:;]/g, ' ').trim();
    if (inledning && !BRUS.test(inledning)) gata = inledning;
    if (!gata) { otolkade.push(original.trim()); return; }

    // Husnumren står först i varje kommaavgränsad del, texten är gemensam.
    const nummer = [];
    const anteckning = [];
    delat[2].split(/[,;.]/).forEach((del) => {
      const d = del.trim();
      if (!d) return;
      // Husbokstaven är ett ensamt tecken ("10b"); "1nej" är nummer 1 plus text.
      const m = d.match(/^(\d+)\s*(?:([a-zA-ZåäöÅÄÖ])(?![a-zA-ZåäöÅÄÖ]))?\s*(.*)$/);
      if (m) {
        nummer.push(m[1] + (m[2] ? ' ' + m[2].toUpperCase() : ''));
        if (m[3].trim()) anteckning.push(m[3].trim());
      } else {
        anteckning.push(d);
      }
    });

    if (!nummer.length) { otolkade.push(original.trim()); return; }
    const kommentar = anteckning.join(', ');
    nummer.forEach((n) => {
      dorrar.push({
        gata,
        nummer: n,
        postort: postort || '',
        resultat: tolkaUtfall(kommentar),
        kommentar,
        rad: original.trim(),
      });
    });
  });

  return { dorrar, otolkade };
}

/* ══ Panel ══ */

const UTFALLSVAL = ['bokat', 'ejsvar', 'nej', 'aterkom'];

let tolkade = [];
let ejTolkade = [];

/** Steg 1: klistra in texten. */
export function visaImport(omraden, valtOmrade) {
  const omradesVal = omraden.length
    ? '<div class="field"><label for="anOmrade">Område</label><select id="anOmrade">' +
      '<option value="">Övriga adresser</option>' +
      omraden.map((o) => '<option value="' + esc(o.id) + '"' +
        (o.id === valtOmrade ? ' selected' : '') + '>' + esc(o.namn) + '</option>').join('') +
      '</select></div>'
    : '';

  oppnaPanel('dorr',
    '<h2>Klistra in anteckningar</h2>' +
    '<p class="sub">En gata på egen rad, sedan husnumren med din notering: ' +
    '<i>16, nej</i> — <i>22 ej svar</i> — <i>1,3,5 nej</i>. Du får se tolkningen innan något sparas.</p>' +
    '<div class="field" style="margin-top:14px"><label for="anText">Anteckningar</label>' +
    '<textarea id="anText" rows="10" placeholder="Törngatan&#10;16, nej&#10;22, ej svar&#10;18, fick lapp"></textarea></div>' +
    '<div class="field"><label for="anPostort">Postort</label>' +
    '<input id="anPostort" type="text" placeholder="Örebro" autocomplete="off"></div>' +
    omradesVal +
    '<div class="err" id="anFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="anAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="anTolka">Tolka</button></div>');

  $('anAvbryt').onclick = () => stangPanel('dorr');
  $('anTolka').onclick = () => {
    const text = $('anText').value;
    const postort = $('anPostort').value.trim();
    const svar = tolkaAnteckningar(text, postort);
    if (!svar.dorrar.length) {
      $('anFel').textContent = 'Hittade inga husnummer i texten.';
      return;
    }
    tolkade = svar.dorrar;
    ejTolkade = svar.otolkade;
    visaGranskning(postort, $('anOmrade') ? $('anOmrade').value : '');
  };
}

/** Steg 2: granska och rätta innan något sparas. */
function visaGranskning(postort, omradeId) {
  const gator = [];
  tolkade.forEach((d) => { if (!gator.includes(d.gata)) gator.push(d.gata); });

  const rader = gator.map((gata, gi) =>
    '<div class="an-gata">' +
    '<input class="an-gatnamn" data-gata="' + gi + '" value="' + esc(gata) + '" aria-label="Gatunamn">' +
    tolkade.map((d, i) => d.gata !== gata ? '' :
      '<div class="an-rad">' +
      '<span class="an-nr">' + esc(d.nummer) + '</span>' +
      '<select class="an-utfall" data-i="' + i + '">' +
      '<option value="">— inget besök</option>' +
      UTFALLSVAL.map((r) => '<option value="' + r + '"' + (d.resultat === r ? ' selected' : '') + '>' +
        esc(RESULTAT_TEXT[r]) + '</option>').join('') +
      '</select>' +
      '<span class="an-komm">' + esc(d.kommentar) + '</span>' +
      '</div>').join('') +
    '</div>').join('');

  const oklara = ejTolkade.length
    ? '<h3>Kunde inte tolkas</h3><div class="an-oklar">' +
      ejTolkade.map((r) => '<div>' + esc(r) + '</div>').join('') +
      '<p class="sub">De här raderna saknar husnummer. Lägg in dem med Manuell bokning.</p></div>'
    : '';

  oppnaPanel('dorr',
    '<h2>Granska tolkningen</h2>' +
    '<p class="sub">' + tolkade.length + ' dörrar på ' + gator.length + ' gator' +
    (postort ? ' i ' + esc(postort) : '') + '. Rätta gatunamn och utfall innan du sparar.</p>' +
    '<div class="an-lista">' + rader + '</div>' + oklara +
    '<div class="err" id="anFel2"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="anTillbaka">Tillbaka</button>' +
    '<button class="btn btn-primary" id="anSpara">Spara ' + tolkade.length + ' dörrar</button></div>');

  const panel = $('dorrPanel');
  panel.querySelectorAll('.an-utfall').forEach((s) => {
    s.onchange = () => { tolkade[+s.dataset.i].resultat = s.value || null; };
  });
  panel.querySelectorAll('.an-gatnamn').forEach((f) => {
    const gammal = gator[+f.dataset.gata];
    f.onchange = () => {
      const nytt = f.value.trim();
      if (!nytt) { f.value = gammal; return; }
      tolkade.forEach((d) => { if (d.gata === gammal) d.gata = nytt; });
      gator[+f.dataset.gata] = nytt;
    };
  });

  $('anTillbaka').onclick = () => visaImport(S.omraden, omradeId);
  $('anSpara').onclick = () => spara(postort, omradeId);
}

/** Steg 3: spara i omgångar så att en lång lista inte tar timeout. */
async function spara(postort, omradeId) {
  const knapp = $('anSpara');
  knapp.disabled = true;
  const logg = document.createElement('pre');
  logg.className = 'importlogg';
  knapp.parentNode.insertBefore(logg, knapp.parentNode.firstChild);

  const klara = [];
  const fel = [];
  for (let i = 0; i < tolkade.length; i += 20) {
    const del = tolkade.slice(i, i + 20);
    logg.textContent = 'Sparar ' + Math.min(i + del.length, tolkade.length) + ' av ' + tolkade.length + '…';
    try {
      const svar = await anrop('anteckningar-importera', { rader: del, postort, omrade_id: omradeId || undefined });
      (svar.rader || []).forEach((r) => (r.fel ? fel.push(r) : klara.push(r)));
    } catch (e) {
      fel.push({ gata: del[0].gata, nummer: del[0].nummer, fel: e.message });
      break;
    }
  }

  const nya = klara.filter((r) => !r.fanns).length;
  const besok = klara.filter((r) => r.resultat).length;
  logg.textContent =
    klara.length + ' dörrar sparade (' + nya + ' nya, ' + (klara.length - nya) + ' fanns redan)\n' +
    besok + ' besök registrerade' +
    (fel.length ? '\n\nMisslyckades:\n' + fel.map((f) =>
      (f.gata || '') + ' ' + (f.nummer || '') + ' — ' + f.fel).join('\n') : '');

  knapp.textContent = 'Klart';
  knapp.disabled = false;
  knapp.onclick = () => stangPanel('dorr');
  toast(klara.length + ' dörrar sparade');
  dataAndrad();
}
