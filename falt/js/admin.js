/** Administration: områden, adressimport, användare samt spärregler och mål. */

import { anrop } from './api.js';
import { $, esc, toast, oppnaPanel, stangPanel, procent } from './ui.js';
import { S, arRoll, dataAndrad } from './state.js';

let flik = 'omraden';
let omradesData = [];
let anvandarData = [];

/* ══ Adresstolkning ══ */

/**
 * Tolkar inklistrade adresser. Klarar både en adress per rad
 * ("Västeråsvägen 1") och kortformen "Västeråsvägen 1,3,5,7".
 */
export function tolkaAdresser(text, postort) {
  const ut = [];
  String(text || '').split(/\n+/).forEach((rad) => {
    const r = rad.trim();
    if (!r) return;

    const delar = r.split(',').map((d) => d.trim()).filter(Boolean);
    const forsta = delar[0].match(/^(.+?)\s+(\d+\s*[a-zA-ZåäöÅÄÖ]?)$/);
    if (!forsta) return;

    const gata = forsta[1].trim();
    ut.push({ gata, nummer: forsta[2].replace(/\s+/g, ''), postort: postort || null });

    // Efterföljande delar som bara är husnummer hör till samma gata.
    delar.slice(1).forEach((d) => {
      if (/^\d+\s*[a-zA-ZåäöÅÄÖ]?$/.test(d)) {
        ut.push({ gata, nummer: d.replace(/\s+/g, ''), postort: postort || null });
      }
    });
  });
  return ut;
}

/** Hämtar husnummer med koordinater från OpenStreetMap. */
async function hamtaFranKarta(gata, ort) {
  const fraga =
    '[out:json][timeout:30];' +
    'area[name="' + ort.replace(/"/g, '') + '"]->.a;' +
    '(node["addr:street"="' + gata.replace(/"/g, '') + '"](area.a);' +
    'way["addr:street"="' + gata.replace(/"/g, '') + '"](area.a););' +
    'out center;';

  const svar = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(fraga),
  });
  if (!svar.ok) throw new Error('Kartsökningen svarade ' + svar.status);
  const data = await svar.json();

  return (data.elements || [])
    .map((e) => ({
      gata: (e.tags && e.tags['addr:street']) || gata,
      nummer: e.tags && e.tags['addr:housenumber'],
      postort: (e.tags && e.tags['addr:city']) || ort,
      lat: e.lat || (e.center && e.center.lat),
      lon: e.lon || (e.center && e.center.lon),
    }))
    .filter((a) => a.nummer && a.lat);
}

/* ══ Områden ══ */

async function ladda() {
  const [o, a] = await Promise.all([
    anrop('omraden'),
    arRoll('teamleader') ? anrop('anvandare-lista') : Promise.resolve({ anvandare: [] }),
  ]);
  omradesData = o.omraden || [];
  anvandarData = a.anvandare || [];
}

function ritaOmraden() {
  if (!omradesData.length) {
    return '<div class="tom">Inga områden än.<br>Skapa ett område och importera adresserna till det.</div>' +
      '<div class="sektion"><button class="btn btn-primary" id="nyttOmrade">Nytt område</button></div>';
  }

  return '<div class="lista">' + omradesData.map((o) =>
    '<div class="kort s-ejbesokt">' +
    '<div class="kort-topp"><div>' +
    '<div class="adress">' + esc(o.namn) + '</div>' +
    '<div class="under">' + esc(o.ort || '') + (o.ort ? ' · ' : '') + o.totalt + ' adresser</div>' +
    '</div><span class="märke m-ejbesokt">' + o.procent + ' %</span></div>' +
    '<div class="rad"><span>' + o.besokta + ' besökta</span><span>' + o.ejbesokta + ' ej besökta</span>' +
    (o.saljare.length ? '<span>' + esc(o.saljare.map((s) => s.namn).join(', ')) + '</span>' : '<span>Ingen tilldelad</span>') +
    '</div>' +
    '<div class="chips">' +
    '<button class="chip" data-import="' + esc(o.id) + '">Importera adresser</button>' +
    '<button class="chip" data-tilldela="' + esc(o.id) + '">Tilldela säljare</button>' +
    '<button class="chip" data-redigera="' + esc(o.id) + '">Byt namn</button>' +
    '</div></div>').join('') +
    '</div><div class="sektion"><button class="btn btn-primary" id="nyttOmrade">Nytt område</button></div>';
}

function omradesFormular(o) {
  oppnaPanel('modal',
    '<h2>' + (o ? 'Ändra område' : 'Nytt område') + '</h2>' +
    '<div class="field"><label for="oNamn">Namn</label>' +
    '<input id="oNamn" type="text" placeholder="Västeråsvägen" value="' + esc(o ? o.namn : '') + '"></div>' +
    '<div class="field"><label for="oOrt">Ort</label>' +
    '<input id="oOrt" type="text" placeholder="Västerås" value="' + esc(o ? o.ort || '' : '') + '"></div>' +
    '<div class="err" id="oFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="oAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="oSpara">Spara</button></div>');

  $('oAvbryt').onclick = () => stangPanel('modal');
  $('oSpara').onclick = async () => {
    const namn = $('oNamn').value.trim();
    if (!namn) { $('oFel').textContent = 'Namn krävs.'; return; }
    try {
      await anrop('omrade-spara', { id: o ? o.id : undefined, namn, ort: $('oOrt').value.trim() });
      stangPanel('modal');
      toast('Området sparat');
      await rita();
      dataAndrad();
    } catch (e) { $('oFel').textContent = e.message; }
  };
}

function tilldelaFormular(o) {
  const saljare = anvandarData.filter((a) => a.aktiv);
  let valda = o.saljare.map((s) => s.id);

  const rita_ = () => {
    oppnaPanel('modal',
      '<h2>Tilldela ' + esc(o.namn) + '</h2>' +
      '<p class="sub">Säljare som får se och jobba i området. Utan tilldelning ser alla området.</p>' +
      '<div class="chips" style="margin:14px 0">' +
      saljare.map((s) => '<button class="chip' + (valda.includes(s.id) ? ' vald' : '') +
        '" data-s="' + esc(s.id) + '">' + esc(s.namn) + '</button>').join('') + '</div>' +
      '<div class="btn-rad"><button class="btn btn-ghost" id="tAvbryt">Avbryt</button>' +
      '<button class="btn btn-primary" id="tSpara">Spara</button></div>');

    document.querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.s;
        valda = valda.includes(id) ? valda.filter((x) => x !== id) : valda.concat(id);
        rita_();
      };
    });
    $('tAvbryt').onclick = () => stangPanel('modal');
    $('tSpara').onclick = async () => {
      try {
        await anrop('omrade-tilldela', { omrade_id: o.id, saljare: valda });
        stangPanel('modal');
        toast('Tilldelningen sparad');
        await rita();
      } catch (e) { toast(e.message); }
    };
  };
  rita_();
}

function importFormular(o) {
  oppnaPanel('modal',
    '<h2>Importera adresser</h2><p class="sub">Till ' + esc(o.namn) + '. Adresser som redan finns hoppas över.</p>' +
    '<h3>Hämta från kartan</h3>' +
    '<div class="rad2">' +
    '<div class="field"><label for="iGata">Gata</label><input id="iGata" type="text" placeholder="Västeråsvägen" value="' + esc(o.namn) + '"></div>' +
    '<div class="field"><label for="iOrt">Ort</label><input id="iOrt" type="text" placeholder="Västerås" value="' + esc(o.ort || '') + '"></div>' +
    '</div>' +
    '<button class="btn btn-ghost" id="iHamta">Sök husnummer på gatan</button>' +
    '<h3>Eller klistra in</h3>' +
    '<div class="field"><textarea id="iText" style="min-height:120px" placeholder="Västeråsvägen 1&#10;Västeråsvägen 3&#10;&#10;eller: Västeråsvägen 1,3,5,7,9"></textarea></div>' +
    '<div class="field"><label for="iPostort">Postort (frivillig)</label><input id="iPostort" type="text" value="' + esc(o.ort || '') + '"></div>' +
    '<div class="err" id="iFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="iAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="iSpara">Importera</button></div>');

  let franKarta = [];

  $('iHamta').onclick = async () => {
    const gata = $('iGata').value.trim(), ort = $('iOrt').value.trim();
    if (!gata || !ort) { $('iFel').textContent = 'Fyll i både gata och ort.'; return; }
    $('iHamta').textContent = 'Söker…';
    try {
      franKarta = await hamtaFranKarta(gata, ort);
      $('iHamta').textContent = franKarta.length
        ? 'Hittade ' + franKarta.length + ' husnummer — tryck Importera'
        : 'Hittade inga husnummer — klistra in istället';
      $('iFel').textContent = '';
    } catch (e) {
      $('iHamta').textContent = 'Sök husnummer på gatan';
      $('iFel').textContent = 'Kartsökningen misslyckades: ' + e.message;
    }
  };

  $('iAvbryt').onclick = () => stangPanel('modal');
  $('iSpara').onclick = async () => {
    const inklistrade = tolkaAdresser($('iText').value, $('iPostort').value.trim());
    const adresser = franKarta.concat(inklistrade);
    if (!adresser.length) { $('iFel').textContent = 'Inga adresser att importera.'; return; }
    $('iSpara').textContent = 'Importerar…';
    try {
      const svar = await anrop('adresser-importera', { omrade_id: o.id, adresser });
      stangPanel('modal');
      toast(svar.nya + ' nya adresser' + (svar.fanns ? ', ' + svar.fanns + ' fanns redan' : ''));
      await rita();
      dataAndrad();
    } catch (e) {
      $('iSpara').textContent = 'Importera';
      $('iFel').textContent = e.message;
    }
  };
}

/* ══ Användare ══ */

function ritaAnvandare() {
  const roller = { admin: 'Admin', teamleader: 'Teamleader', saljare: 'Säljare' };
  return '<div class="lista">' + anvandarData.map((a) =>
    '<div class="kort ' + (a.aktiv ? 's-bokat' : 's-nej') + '">' +
    '<div class="kort-topp"><div>' +
    '<div class="adress">' + esc(a.namn) + '</div>' +
    '<div class="under">' + esc(a.epost) + (a.team ? ' · ' + esc(a.team) : '') + '</div>' +
    '</div><span class="märke m-' + (a.aktiv ? 'bokat' : 'nej') + '">' + esc(roller[a.roll] || a.roll) + '</span></div>' +
    (arRoll('admin') ? '<div class="chips"><button class="chip" data-anv="' + esc(a.id) + '">Ändra</button></div>' : '') +
    '</div>').join('') + '</div>' +
    (arRoll('admin') ? '<div class="sektion"><button class="btn btn-primary" id="nyAnvandare">Ny användare</button></div>' : '');
}

function anvandarFormular(a) {
  oppnaPanel('modal',
    '<h2>' + (a ? 'Ändra användare' : 'Ny användare') + '</h2>' +
    '<div class="field"><label for="aNamn">Namn</label><input id="aNamn" type="text" value="' + esc(a ? a.namn : '') + '"></div>' +
    '<div class="field"><label for="aEpost">E-post</label><input id="aEpost" type="email" autocapitalize="off" value="' + esc(a ? a.epost : '') + '"></div>' +
    '<div class="rad2">' +
    '<div class="field"><label for="aRoll">Roll</label><select id="aRoll">' +
    ['saljare', 'teamleader', 'admin'].map((r) =>
      '<option value="' + r + '"' + (a && a.roll === r ? ' selected' : '') + '>' +
      ({ saljare: 'Säljare', teamleader: 'Teamleader', admin: 'Admin' })[r] + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label for="aTeam">Team</label><input id="aTeam" type="text" value="' + esc(a ? a.team || '' : '') + '"></div>' +
    '</div>' +
    '<div class="field"><label for="aLosen">' + (a ? 'Nytt lösenord (lämna tomt för oförändrat)' : 'Lösenord') +
    '</label><input id="aLosen" type="text" autocomplete="new-password" placeholder="minst 8 tecken"></div>' +
    (a ? '<div class="field"><label><input type="checkbox" id="aAktiv" style="width:auto;margin-right:8px"' +
      (a.aktiv ? ' checked' : '') + '>Aktiv</label></div>' : '') +
    '<div class="err" id="aFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="aAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="aSpara">Spara</button></div>');

  $('aAvbryt').onclick = () => stangPanel('modal');
  $('aSpara').onclick = async () => {
    try {
      await anrop('anvandare-spara', {
        id: a ? a.id : undefined,
        namn: $('aNamn').value.trim(),
        epost: $('aEpost').value.trim(),
        roll: $('aRoll').value,
        team: $('aTeam').value.trim(),
        losenord: $('aLosen').value || undefined,
        aktiv: a ? $('aAktiv').checked : true,
      });
      stangPanel('modal');
      toast('Användaren sparad');
      await rita();
    } catch (e) { $('aFel').textContent = e.message; }
  };
}

/* ══ Regler och mål ══ */

function ritaRegler() {
  const i = S.installningar;
  const falt = (nyckel, etikett, hjalp) =>
    '<div class="field"><label for="r_' + nyckel + '">' + esc(etikett) + '</label>' +
    '<input id="r_' + nyckel + '" type="number" min="0" value="' + esc(i[nyckel] || '0') + '">' +
    (hjalp ? '<div class="sub" style="margin-top:5px">' + esc(hjalp) + '</div>' : '') + '</div>';

  return '<div class="sektion">' +
    '<h3>Hur länge en dörr är fredad</h3><div class="panelkort">' +
    falt('sparr_nej', 'Efter NEJ (dagar)', 'Dörren varnar och räknas som spärrad så här länge.') +
    falt('sparr_ejsvar', 'Efter INGET SVAR (dagar)') +
    falt('sparr_bokat', 'Efter BOKAT (dagar)') +
    falt('nyligen_dagar', 'Visa "nyligen besökt" (dagar)') +
    '</div>' +
    '<h3>Hit rate</h3><div class="panelkort">' +
    '<div class="field"><label for="r_hitrate_namnare">Räkna bokningar mot</label>' +
    '<select id="r_hitrate_namnare">' +
    [['alla', 'Alla knackade dörrar'], ['oppnade', 'Dörrar där någon öppnade'], ['positiva', 'Positiva samtal']]
      .map(([v, t]) => '<option value="' + v + '"' + (i.hitrate_namnare === v ? ' selected' : '') + '>' + t + '</option>').join('') +
    '</select><div class="sub" style="margin-top:5px">Öppnat räknas automatiskt: allt utom "inget svar". ' +
    'Positivt samtal = bokat eller återkom.</div></div></div>' +
    '<h3>Dagliga mål per säljare</h3><div class="panelkort">' +
    falt('mal_dorrar', 'Dörrar') +
    falt('mal_bokningar', 'Bokningar') +
    falt('mal_hitrate', 'Hit rate (%)') +
    '</div>' +
    '<button class="btn btn-primary" id="sparaRegler" style="margin-top:16px">Spara inställningar</button></div>';
}

/* ══ Rendering ══ */

export async function rita() {
  const behallare = $('adminInnehall');
  if (!omradesData.length && !anvandarData.length) behallare.innerHTML = '<div class="tom">Hämtar…</div>';
  try {
    await ladda();
  } catch (e) {
    behallare.innerHTML = '<div class="tom">Kunde inte hämta: ' + esc(e.message) + '</div>';
    return;
  }

  $('vySub').textContent = omradesData.length + ' områden · ' + anvandarData.length + ' användare';
  behallare.innerHTML = flik === 'omraden' ? ritaOmraden()
    : flik === 'anvandare' ? ritaAnvandare()
    : ritaRegler();

  const nytt = $('nyttOmrade');
  if (nytt) nytt.onclick = () => omradesFormular(null);
  behallare.querySelectorAll('[data-import]').forEach((b) => {
    b.onclick = () => importFormular(omradesData.find((o) => o.id === b.dataset.import));
  });
  behallare.querySelectorAll('[data-tilldela]').forEach((b) => {
    b.onclick = () => tilldelaFormular(omradesData.find((o) => o.id === b.dataset.tilldela));
  });
  behallare.querySelectorAll('[data-redigera]').forEach((b) => {
    b.onclick = () => omradesFormular(omradesData.find((o) => o.id === b.dataset.redigera));
  });

  const nyAnv = $('nyAnvandare');
  if (nyAnv) nyAnv.onclick = () => anvandarFormular(null);
  behallare.querySelectorAll('[data-anv]').forEach((b) => {
    b.onclick = () => anvandarFormular(anvandarData.find((a) => a.id === b.dataset.anv));
  });

  const spara = $('sparaRegler');
  if (spara) {
    spara.onclick = async () => {
      const ut = {};
      ['sparr_nej', 'sparr_ejsvar', 'sparr_bokat', 'nyligen_dagar', 'mal_dorrar', 'mal_bokningar', 'mal_hitrate']
        .forEach((k) => { ut[k] = $('r_' + k).value; });
      ut.hitrate_namnare = $('r_hitrate_namnare').value;
      try {
        const svar = await anrop('installningar-spara', { installningar: ut });
        S.installningar = svar.installningar;
        toast('Inställningarna sparade');
      } catch (e) { toast(e.message); }
    };
  }
}

export function koppla() {
  $('adminFlikar').addEventListener('click', (ev) => {
    const b = ev.target.closest('.flik');
    if (!b) return;
    flik = b.dataset.admin;
    $('adminFlikar').querySelectorAll('.flik').forEach((x) => x.classList.toggle('aktiv', x === b));
    rita();
  });
}
