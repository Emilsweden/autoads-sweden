/**
 * Dörrpanelen. Flödet ute på gatan ska vara: tryck på adress → välj resultat → klart.
 * Panelen visar också dörrens historik och varnar om den nyligen bearbetats.
 */

import { anrop, ApiFel, laggIKo } from './api.js';
import {
  $, esc, toast, oppnaPanel, stangPanel, idag, plusDagar, visaDatum, visaTidpunkt,
  sedan, STATUS_TEXT, RESULTAT_TEXT, NEJ_ORSAKER,
} from './ui.js';
import { S, arRoll, dataAndrad } from './state.js';
import { delaAdress, vagbeskrivning, kartappNamn } from './geo.js';
import { ledigaTider } from './kalender.js';

let aktuell = null;   // { adress, historik, bokningar }

/* ── Tidsval ── */

function kl(timmar, minuter = 0) {
  return String(timmar).padStart(2, '0') + ':' + String(minuter).padStart(2, '0');
}

function omTvaTimmar() {
  const d = new Date(Date.now() + 2 * 3600000);
  return kl(d.getHours(), d.getMinutes() < 30 ? 0 : 30);
}

function nastaHelg() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

const TIDSVAL = {
  ejsvar: [
    { text: 'Senare idag', datum: () => idag(), tid: omTvaTimmar },
    { text: 'Ikväll', datum: () => idag(), tid: () => '18:00' },
    { text: 'Imorgon', datum: () => plusDagar(1), tid: () => '' },
    { text: 'I helgen', datum: nastaHelg, tid: () => '' },
    { text: 'Egen tid', eget: true },
    { text: 'Ingen återkomst', ingen: true },
  ],
  aterkom: [
    { text: 'Ikväll', datum: () => idag(), tid: () => '18:00' },
    { text: 'Imorgon', datum: () => plusDagar(1), tid: () => '' },
    { text: 'I helgen', datum: nastaHelg, tid: () => '' },
    { text: 'Nästa vecka', datum: () => plusDagar(7), tid: () => '' },
    { text: 'Om två veckor', datum: () => plusDagar(14), tid: () => '' },
    { text: 'Egen tid', eget: true },
  ],
};

/* ── Skicka registrering ── */

async function skicka(resultat, extra = {}, bekrafta = false, vidTidskrock = null) {
  const data = {
    adress_id: aktuell.adress.id,
    resultat,
    ...extra,
    ...(S.position ? { lat: S.position.lat, lon: S.position.lon } : {}),
    ...(bekrafta ? { bekrafta: true } : {}),
  };

  try {
    await anrop('handelse', data);
    toast(resultat === 'bokat' ? 'Bokning sparad ✓' : RESULTAT_TEXT[resultat] + ' registrerat ✓');
    stangPanel('dorr');
    dataAndrad();
  } catch (e) {
    if (e instanceof ApiFel && e.status === 409 && e.data) {
      visaSparrvarning(e.data, resultat, extra);
      return;
    }
    // Någon annan hann boka tiden — formuläret visar de lediga på nytt.
    if (e instanceof ApiFel && e.status === 409 && vidTidskrock) {
      vidTidskrock(e.message);
      return;
    }
    if (e instanceof ApiFel && e.status === 0) {
      // Utan täckning sparas besöket i kön och skickas upp automatiskt senare.
      laggIKo(data);
      toast('Sparat i kön — skickas när nätet är tillbaka');
      stangPanel('dorr');
      dataAndrad();
      return;
    }
    toast('Kunde inte spara: ' + e.message);
  }
}

function visaSparrvarning(info, resultat, extra) {
  const panel = $('dorrPanel');
  const varning = document.createElement('div');
  varning.className = 'varning';
  varning.innerHTML =
    '<b>Den här dörren är nyligen bearbetad.</b><br>' +
    'Senaste resultat: ' + esc(RESULTAT_TEXT[info.senast_resultat] || info.senast_resultat || 'okänt') +
    (info.senast_tid ? ' — ' + esc(visaTidpunkt(info.senast_tid)) : '') + '.<br>' +
    (info.sparrad_till ? 'Fredad till ' + esc(visaDatum(new Date(info.sparrad_till).toISOString().slice(0, 10))) + '. ' : '') +
    'Vill du verkligen kontakta adressen igen?' +
    '<div class="btn-rad">' +
    '<button class="btn btn-ghost" id="sparrAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="sparrForts">Registrera ändå</button></div>';

  panel.insertBefore(varning, panel.firstChild.nextSibling);
  panel.scrollTop = 0;
  $('sparrAvbryt').onclick = () => varning.remove();
  $('sparrForts').onclick = () => { varning.remove(); skicka(resultat, extra, true); };
}

/* ── Delflöden ── */

function visaTidsval(resultat) {
  const val = TIDSVAL[resultat];
  const html =
    '<h3>' + (resultat === 'ejsvar' ? 'När ska vi återkomma?' : 'När vill kunden att vi återkommer?') + '</h3>' +
    '<div class="chips">' +
    val.map((v, i) => '<button class="chip" data-i="' + i + '">' + esc(v.text) + '</button>').join('') +
    '</div>' +
    '<div id="egetTid" hidden><div class="rad2" style="margin-top:12px">' +
    '<div class="field"><label for="eDatum">Datum</label><input id="eDatum" type="date" value="' + plusDagar(1) + '"></div>' +
    '<div class="field"><label for="eTid">Tid</label><input id="eTid" type="time" step="900"></div></div>' +
    '<button class="btn btn-primary" id="egetSpara">Spara</button></div>' +
    '<div class="field" style="margin-top:16px"><label for="kommentar">Kommentar (frivillig)</label>' +
    '<input id="kommentar" type="text" placeholder="T.ex. bara barn hemma"></div>';

  const panel = oppnaPanel('dorr', huvudRubrik() + html);
  panel.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      const v = val[+b.dataset.i];
      const kommentar = ($('kommentar').value || '').trim();
      if (v.eget) {
        $('egetTid').hidden = false;
        $('egetSpara').onclick = () =>
          skicka(resultat, { aterkom_datum: $('eDatum').value, aterkom_tid: $('eTid').value, kommentar });
        return;
      }
      if (v.ingen) { skicka(resultat, { kommentar }); return; }
      skicka(resultat, { aterkom_datum: v.datum(), aterkom_tid: v.tid(), kommentar });
    };
  });
}

function visaNej() {
  const html =
    '<h3>Anledning</h3><div class="chips">' +
    NEJ_ORSAKER.map((o, i) => '<button class="chip" data-i="' + i + '">' + esc(o) + '</button>').join('') +
    '</div>' +
    '<div class="field" style="margin-top:16px"><label for="kommentar">Kommentar (frivillig)</label>' +
    '<input id="kommentar" type="text" placeholder="Egen anteckning"></div>' +
    '<button class="btn btn-ghost" id="nejAterkom" style="margin-top:6px">Kunden vill att vi återkommer senare</button>';

  const panel = oppnaPanel('dorr', huvudRubrik() + html);
  let vald = null;
  panel.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      vald = NEJ_ORSAKER[+b.dataset.i];
      skicka('nej', { orsak: vald, kommentar: ($('kommentar').value || '').trim() });
    };
  });
  $('nejAterkom').onclick = () => visaTidsval('aterkom');
}

function visaBokning() {
  const a = aktuell.adress;
  const html =
    '<h3>Bokad takbesiktning</h3>' +
    '<div class="rad2">' +
    '<div class="field"><label for="bFornamn">Förnamn</label><input id="bFornamn" type="text" autocomplete="given-name"></div>' +
    '<div class="field"><label for="bEfternamn">Efternamn</label><input id="bEfternamn" type="text" autocomplete="family-name"></div>' +
    '</div>' +
    '<div class="field"><label for="bTelefon">Mobilnummer</label><input id="bTelefon" type="tel" inputmode="tel" placeholder="070-123 45 67"></div>' +
    '<div class="field"><label for="bDatum">Datum</label><input id="bDatum" type="date" value="' + plusDagar(1) + '"></div>' +
    '<div class="chips" id="bokChips">' +
    ['Idag', 'Imorgon', 'Om 2 dgr', 'Om 1 vecka'].map((t, i) =>
      '<button class="chip" data-d="' + [0, 1, 2, 7][i] + '">' + t + '</button>').join('') +
    '</div>' +
    '<h3>Ledig tid</h3><div id="bTider" class="chips tider">Hämtar tider…</div>' +
    '<div id="bSaljarRad"></div>' +
    '<div class="field" style="margin-top:14px"><label for="bKomm">Kommentar / takinformation</label>' +
    '<textarea id="bKomm" placeholder="T.ex. tegeltak, ca 15 år, mossa på norrsidan"></textarea></div>' +
    '<div class="err" id="bFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="bAvbryt">Tillbaka</button>' +
    '<button class="btn btn-primary" id="bSpara">Spara bokning</button></div>';

  const panel = oppnaPanel('dorr', huvudRubrik() + html);
  let valdTid = '';
  let valdSaljare = '';
  let ledigaPer = {};

  /**
   * Tiderna hämtas från kalendern, så att två mötesbokare inte säljer in
   * samma tid hos samma säljare. Är flera säljare lediga väljs en av dem —
   * annars tar servern den som är ledig.
   */
  async function laddaTider() {
    valdTid = '';
    valdSaljare = '';
    $('bSaljarRad').innerHTML = '';
    const ruta = $('bTider');
    ruta.textContent = 'Hämtar tider…';
    try {
      const svar = await ledigaTider($('bDatum').value);
      ledigaPer = svar.saljarePer || {};
      if (!svar.tider.length) {
        ruta.innerHTML = '<span class="sub">' +
          (svar.saljare && svar.saljare.length
            ? 'Ingen besiktare har någon ledig tid den dagen.'
            : 'Ingen besiktare är upplagd än.') + '</span>';
        return;
      }
      ruta.innerHTML = svar.tider.map((t) =>
        '<button class="chip" data-tid="' + esc(t) + '">' + esc(t) + '</button>').join('');
      ruta.querySelectorAll('[data-tid]').forEach((b) => {
        b.onclick = () => {
          valdTid = b.dataset.tid;
          ruta.querySelectorAll('.chip').forEach((x) => x.classList.toggle('vald', x === b));
          visaSaljarval();
        };
      });
    } catch (e) {
      ruta.innerHTML = '<span class="sub">Kunde inte hämta tider: ' + esc(e.message) + '</span>';
    }
  }

  /**
   * Steget "Välj besiktare": alla som lagt in just den tiden och är lediga
   * visas, och mötesbokaren pekar ut vem som ska ta mötet.
   */
  function visaSaljarval() {
    const lediga = ledigaPer[valdTid] || [];
    valdSaljare = lediga.length ? lediga[0].id : '';
    if (!lediga.length) { $('bSaljarRad').innerHTML = ''; return; }
    if (lediga.length === 1) {
      $('bSaljarRad').innerHTML =
        '<h3>Besiktare</h3><p class="sub">' + esc(lediga[0].namn) + ' är ledig ' +
        esc(valdTid) + ' och tar mötet.</p>';
      return;
    }
    $('bSaljarRad').innerHTML = '<h3>Välj besiktare</h3>' +
      '<div class="chips besiktarval">' +
      lediga.map((s, i) => '<button class="chip' + (i === 0 ? ' vald' : '') +
        '" data-bes="' + esc(s.id) + '">' + esc(s.namn) + ' – ledig</button>').join('') +
      '</div>';
    $('bSaljarRad').querySelectorAll('[data-bes]').forEach((b) => {
      b.onclick = () => {
        valdSaljare = b.dataset.bes;
        $('bSaljarRad').querySelectorAll('.chip').forEach((x) => x.classList.toggle('vald', x === b));
      };
    });
  }

  panel.querySelectorAll('#bokChips .chip').forEach((b) => {
    b.onclick = () => { $('bDatum').value = plusDagar(+b.dataset.d); laddaTider(); };
  });
  $('bDatum').onchange = laddaTider;
  laddaTider();

  $('bAvbryt').onclick = () => oppna(a.id);
  $('bSpara').onclick = () => {
    const fornamn = $('bFornamn').value.trim();
    const telefon = $('bTelefon').value.trim();
    if (!fornamn || !telefon) { $('bFel').textContent = 'Förnamn och mobilnummer krävs.'; return; }
    if (!$('bDatum').value) { $('bFel').textContent = 'Välj datum för besiktningen.'; return; }
    if (!valdTid) { $('bFel').textContent = 'Välj en ledig tid.'; return; }
    if (!valdSaljare) { $('bFel').textContent = 'Välj vilken besiktare som ska ta mötet.'; return; }
    skicka('bokat', {
      fornamn,
      efternamn: $('bEfternamn').value.trim(),
      telefon,
      datum: $('bDatum').value,
      tid: valdTid,
      saljare_id: valdSaljare || undefined,
      kommentar: $('bKomm').value.trim(),
    }, false, (meddelande) => {
      $('bFel').textContent = meddelande;
      laddaTider();
    });
  };
}

/* ── Huvudvy ── */

function huvudRubrik() {
  const a = aktuell.adress;
  // Hela adressen, inte bara husnumret — man ska se vilken gata man står på.
  const svans = [visaPostnr(a.postnummer), a.postort].filter(Boolean).join(' ');
  const hela = [a.gata, a.nummer].filter(Boolean).join(' ') + (svans ? ', ' + svans : '');
  return '<h2>' + esc(hela || a.adress) + '</h2>' +
    '<p class="sub">' + esc(STATUS_TEXT[a.status] || '') + '</p>';
}

function historikHtml() {
  if (aktuell.offline) {
    return '<p class="sub" style="margin-top:8px">Historiken kan inte hämtas utan täckning. ' +
      'Du kan registrera ändå — besöket skickas upp när nätet är tillbaka.</p>';
  }
  if (!aktuell.historik.length) return '<p class="sub" style="margin-top:8px">Inga tidigare besök registrerade.</p>';
  return '<div class="historik">' + aktuell.historik.map((h) => {
    const bokning = aktuell.bokningar.find((b) => b.handelse_id === h.id);
    return '<div class="hpost r-' + esc(h.resultat) + '">' +
      '<div class="htid">' + esc(visaTidpunkt(h.skapad)) + ' · ' + esc(h.saljare || 'Okänd') + '</div>' +
      '<div class="hrad"><b>' + esc(RESULTAT_TEXT[h.resultat] || h.resultat) + '</b>' +
      (h.orsak ? ' — ' + esc(h.orsak) : '') +
      (h.aterkom_datum ? ' · återkom ' + esc(visaDatum(h.aterkom_datum)) + (h.aterkom_tid ? ' kl. ' + esc(h.aterkom_tid) : '') : '') +
      '</div>' +
      (bokning ? '<div class="hkomm">Kund: ' + esc([bokning.fornamn, bokning.efternamn].filter(Boolean).join(' ')) +
        (bokning.telefon ? ' · ' + esc(bokning.telefon) : '') +
        (bokning.datum ? ' · ' + esc(visaDatum(bokning.datum)) + (bokning.tid ? ' kl. ' + esc(bokning.tid) : '') : '') +
        '</div>' : '') +
      (h.kommentar ? '<div class="hkomm">' + esc(h.kommentar) + '</div>' : '') +
      '</div>';
  }).join('') + '</div>';
}

function statusruta() {
  const a = aktuell.adress;
  if (!a.senast_tid) return '';
  const nyligen = a.sparrad_till > Date.now();
  const rader = [
    'Besökt av: <b>' + esc(a.senast_namn || 'okänd') + '</b>',
    'Senast besökt: ' + esc(visaTidpunkt(a.senast_tid)) + ' (' + esc(sedan(a.senast_tid)) + ')',
    'Resultat: ' + esc(RESULTAT_TEXT[a.senast_resultat] || a.senast_resultat || '—'),
  ];
  if (a.aterkom_datum) {
    rader.push('Nästa åtgärd: återkom ' + esc(visaDatum(a.aterkom_datum)) +
      (a.aterkom_tid ? ' kl. ' + esc(a.aterkom_tid) : ''));
  }
  if (a.antal_besok) rader.push('Antal besök: ' + a.antal_besok);

  return '<div class="varning" style="' + (nyligen ? '' : 'background:rgba(255,255,255,0.03);border-color:var(--linje);color:var(--muted)') + '">' +
    (nyligen ? '<b>Nyligen bearbetad dörr</b><br>' : '') + rader.join('<br>') + '</div>';
}

/** Dörrens aktiva bokning, om den har någon. */
function aktivBokning() {
  return (aktuell.bokningar || []).find((b) => b.status === 'bokad') || null;
}

/** Kunden bakom bokningen: uppgifter, kommentar och vad man gör härnäst. */
function kundkort() {
  const b = aktivBokning();
  if (!b) return '';
  const kund = [b.fornamn, b.efternamn].filter(Boolean).join(' ');
  return '<div class="kundkort">' +
    '<div class="kundkort-topp"><span class="märke m-bokat">BOKAD</span>' +
    (b.datum ? '<b>' + esc(visaDatum(b.datum)) + (b.tid ? ' kl. ' + esc(b.tid) : '') + '</b>' : '') +
    '</div>' +
    (kund ? '<div class="kundnamn">' + esc(kund) + '</div>' : '') +
    (b.telefon ? '<div class="kundrad">' + esc(b.telefon) + '</div>' : '') +
    (b.kommentar ? '<div class="kundkomm">' + esc(b.kommentar) + '</div>' : '') +
    '<div class="btn-rad">' +
    (b.telefon ? '<a class="btn btn-primary" id="dRing" href="tel:' + esc(b.telefon.replace(/[^\d+]/g, '')) + '">Ring kund</a>' : '') +
    '<button class="btn btn-ghost" id="dAndra">Ändra bokning</button>' +
    '</div></div>';
}

/** Redigering av en bokning: kund, tid och kommentar på ett ställe. */
function visaAndraBokning() {
  const b = aktivBokning();
  const a = aktuell.adress;
  if (!b) return;

  oppnaPanel('dorr',
    '<h2>Ändra bokning</h2><p class="sub">' + esc(a.adress) + '</p>' +
    '<div class="rad2" style="margin-top:14px">' +
    '<div class="field"><label for="aFornamn">Förnamn</label>' +
    '<input id="aFornamn" type="text" value="' + esc(b.fornamn || '') + '"></div>' +
    '<div class="field"><label for="aEfternamn">Efternamn</label>' +
    '<input id="aEfternamn" type="text" value="' + esc(b.efternamn || '') + '"></div></div>' +
    '<div class="field"><label for="aTelefon">Mobilnummer</label>' +
    '<input id="aTelefon" type="tel" inputmode="tel" value="' + esc(b.telefon || '') + '"></div>' +
    '<div class="field"><label for="aDatum">Datum</label>' +
    '<input id="aDatum" type="date" value="' + esc(b.datum || '') + '"></div>' +
    '<h3>Tid</h3><div id="aTider" class="chips tider">Hämtar tider…</div>' +
    '<div class="field" style="margin-top:14px"><label for="aKomm">Kommentar</label>' +
    '<textarea id="aKomm">' + esc(b.kommentar || '') + '</textarea></div>' +
    '<div class="err" id="aFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="aTillbaka">Tillbaka</button>' +
    '<button class="btn btn-primary" id="aSpara">Spara</button></div>' +
    '<button class="btn btn-ghost" id="aAvboka" style="margin-top:10px">Avboka mötet</button>');

  let valdTid = b.tid || '';

  async function laddaTider() {
    const ruta = $('aTider');
    ruta.textContent = 'Hämtar tider…';
    try {
      const svar = await ledigaTider($('aDatum').value);
      if (svar.helg) { ruta.innerHTML = '<span class="sub">Helg — tider bokas måndag till fredag.</span>'; return; }
      // Den egna tiden är upptagen av bokningen själv men ska gå att behålla.
      const tider = svar.tider.concat($('aDatum').value === b.datum && b.tid ? [b.tid] : [])
        .filter((t, i, alla) => alla.indexOf(t) === i).sort();
      ruta.innerHTML = tider.map((t) => '<button class="chip' + (t === valdTid ? ' vald' : '') +
        '" data-tid="' + esc(t) + '">' + esc(t) + '</button>').join('') ||
        '<span class="sub">Alla tider är bokade den dagen.</span>';
      ruta.querySelectorAll('[data-tid]').forEach((k) => {
        k.onclick = () => {
          valdTid = k.dataset.tid;
          ruta.querySelectorAll('.chip').forEach((x) => x.classList.toggle('vald', x === k));
        };
      });
    } catch (e) {
      ruta.innerHTML = '<span class="sub">Kunde inte hämta tider: ' + esc(e.message) + '</span>';
    }
  }
  laddaTider();
  $('aDatum').onchange = () => { valdTid = ''; laddaTider(); };

  $('aTillbaka').onclick = () => oppna(a.id);
  $('aSpara').onclick = async () => {
    try {
      await anrop('bokning-andra', {
        id: b.id,
        fornamn: $('aFornamn').value.trim(),
        efternamn: $('aEfternamn').value.trim(),
        telefon: $('aTelefon').value.trim(),
        datum: $('aDatum').value,
        tid: valdTid,
        kommentar: $('aKomm').value.trim(),
      });
      toast('Bokningen är ändrad ✓');
      dataAndrad();
      oppna(a.id);
    } catch (e) { $('aFel').textContent = e.message; }
  };
  $('aAvboka').onclick = async () => {
    if (!confirm('Avboka mötet? Tiden blir ledig igen.')) return;
    try {
      await anrop('bokning-status', { id: b.id, status: 'avbokad' });
      toast('Mötet är avbokat — tiden är ledig igen');
      dataAndrad();
      oppna(a.id);
    } catch (e) { $('aFel').textContent = e.message; }
  };
}

/**
 * Öppnar dörrpanelen för en adress.
 * `direktBokning` hoppar rakt till bokningsformuläret, vilket används av
 * manuell bokning där säljaren redan vet att kunden tackat ja.
 */
export async function oppna(adressId, direktBokning) {
  oppnaPanel('dorr', '<h2>Hämtar…</h2>');
  try {
    const data = await anrop('adress', { id: adressId });
    aktuell = { adress: data.adress, historik: data.historik || [], bokningar: data.bokningar || [] };
  } catch (e) {
    // Utan täckning används dörren som redan finns i telefonen, så att
    // säljaren kan registrera ändå — besöket hamnar då i kön.
    const lokal = S.adresser.find((a) => a.id === adressId);
    if (e.status === 0 && lokal) {
      aktuell = { adress: lokal, historik: [], bokningar: [], offline: true };
    } else {
      oppnaPanel('dorr', '<h2>Kunde inte hämta dörren</h2><p class="sub">' + esc(e.message) + '</p>');
      return;
    }
  }

  const html = huvudRubrik() + kundkort() + statusruta() +
    '<div class="resultat">' +
    '<button class="r-bokat" data-r="bokat">BOKAT</button>' +
    '<button class="r-ejsvar" data-r="ejsvar">INGET SVAR</button>' +
    '<button class="r-nej" data-r="nej">NEJ</button>' +
    '<button class="r-aterkom" data-r="aterkom">ÅTERKOM</button>' +
    '</div>' +
    '<h3>Historik</h3>' + historikHtml() +
    '<div class="btn-rad">' +
    '<button class="btn btn-ghost" id="dVag">Vägbeskrivning</button>' +
    (arRoll('teamleader') && !aktuell.offline
      ? '<button class="btn btn-ghost" id="dRatta">Rätta adressen</button>' : '') +
    '</div>';

  const panel = oppnaPanel('dorr', html);
  panel.querySelectorAll('.resultat button').forEach((b) => {
    b.onclick = () => {
      const r = b.dataset.r;
      if (r === 'bokat') visaBokning();
      else if (r === 'nej') visaNej();
      else visaTidsval(r);
    };
  });
  if ($('dAndra')) $('dAndra').onclick = visaAndraBokning;
  if ($('dRatta')) $('dRatta').onclick = visaRatta;
  // Öppnar dörrens adress i telefonens kartapp för att gå eller köra dit.
  $('dVag').onclick = () => {
    toast('Öppnar ' + kartappNamn());
    window.open(vagbeskrivning(aktuell.adress), '_blank', 'noopener');
  };

  if (direktBokning) visaBokning();
}

/**
 * Rättar en dörr som fått fel adress — t.ex. när hela adressen klistrats in
 * i gatufältet — eller tar bort den helt om den aldrig har besökts.
 */
function visaRatta() {
  const a = aktuell.adress;
  oppnaPanel('dorr',
    '<h2>Rätta adressen</h2>' +
    '<p class="sub">Historiken följer med dörren, bara adresstexten ändras.</p>' +
    '<div class="field" style="margin-top:16px"><label for="rGata">Gata</label>' +
    '<input id="rGata" type="text" value="' + esc(a.gata || '') + '" autocomplete="off"></div>' +
    '<div class="rad2">' +
    '<div class="field"><label for="rNummer">Husnummer</label>' +
    '<input id="rNummer" type="text" value="' + esc(a.nummer || '') + '" autocomplete="off"></div>' +
    '<div class="field"><label for="rPostnummer">Postnummer</label>' +
    '<input id="rPostnummer" type="text" inputmode="numeric" placeholder="721 34" value="' +
    esc(visaPostnr(a.postnummer)) + '" autocomplete="off"></div>' +
    '</div>' +
    '<div class="field"><label for="rPostort">Postort</label>' +
    '<input id="rPostort" type="text" value="' + esc(a.postort || '') + '" autocomplete="off"></div>' +
    '<div class="err" id="rFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="rTillbaka">Tillbaka</button>' +
    '<button class="btn btn-primary" id="rSpara">Spara</button></div>' +
    '<button class="btn btn-ghost" id="rBort" style="margin-top:10px">Ta bort dörren</button>');

  delaVidInmatning('rGata', 'rNummer', 'rPostort', 'rPostnummer');

  $('rTillbaka').onclick = () => oppna(a.id);
  $('rSpara').onclick = async () => {
    try {
      const postnr = $('rPostnummer').value.replace(/\D/g, '');
      if (postnr && postnr.length !== 5) {
        $('rFel').textContent = 'Postnumret ska vara fem siffror, t.ex. 721 34.';
        return;
      }
      await anrop('adress-andra', {
        id: a.id,
        gata: $('rGata').value.trim(),
        nummer: $('rNummer').value.trim(),
        postnummer: postnr,
        postort: $('rPostort').value.trim(),
      });
      toast('Adressen är rättad ✓');
      dataAndrad();
      oppna(a.id);
    } catch (e) { $('rFel').textContent = e.message; }
  };
  $('rBort').onclick = async () => {
    if (!confirm('Ta bort ' + (a.adress || 'dörren') + ' helt?')) return;
    try {
      await anrop('adress-ta-bort', { id: a.id });
      toast('Dörren är borttagen');
      stangPanel('dorr');
      dataAndrad();
    } catch (e) { $('rFel').textContent = e.message; }
  };
}

/**
 * Delar upp en hel adress som skrivits i gatufältet, så att
 * "Sippgatan 9, 942 33 Byske" hamnar i rätt rutor i stället för allt i en.
 */
function delaVidInmatning(gataId, nummerId, postortId, postnrId) {
  $(gataId).addEventListener('blur', () => {
    const delad = delaAdress($(gataId).value);
    if (!delad.nummer && !delad.postort && !delad.postnummer) return;
    $(gataId).value = delad.gata;
    if (delad.nummer && !$(nummerId).value.trim()) $(nummerId).value = delad.nummer;
    if (delad.postort && !$(postortId).value.trim()) $(postortId).value = delad.postort;
    if (postnrId && delad.postnummer && $(postnrId) && !$(postnrId).value.trim()) {
      $(postnrId).value = visaPostnr(delad.postnummer);
    }
  });
}

/** "72134" visas som "721 34" i fälten. */
function visaPostnr(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 5 ? d.slice(0, 3) + ' ' + d.slice(3) : '';
}

/**
 * Manuell bokning: säljaren skriver in en adress som inte finns i området,
 * den skapas (eller återanvänds om den redan finns) och bokningen öppnas.
 */
export function manuell(omraden, valtOmrade, forval = {}) {
  const omradesVal = omraden.length
    ? '<div class="field"><label for="mOmrade">Område</label><select id="mOmrade">' +
      '<option value="">Övriga adresser</option>' +
      omraden.map((o) => '<option value="' + esc(o.id) + '"' +
        (o.id === valtOmrade ? ' selected' : '') + '>' + esc(o.namn) + '</option>').join('') +
      '</select></div>'
    : '';

  oppnaPanel('dorr',
    '<h2>Manuell bokning</h2>' +
    '<p class="sub">För en adress som inte finns i listan. Finns den redan används den befintliga dörren, så historiken hänger ihop.</p>' +
    '<div class="field" style="margin-top:16px"><label for="mGata">Gata</label>' +
    '<input id="mGata" type="text" placeholder="Västeråsvägen" autocomplete="off" value="' + esc(forval.gata || '') + '"></div>' +
    '<div class="rad2">' +
    '<div class="field"><label for="mNummer">Husnummer</label><input id="mNummer" type="text" placeholder="17" inputmode="numeric" autocomplete="off" value="' + esc(forval.nummer || '') + '"></div>' +
    '<div class="field"><label for="mPostnummer">Postnummer</label><input id="mPostnummer" type="text" placeholder="721 34" inputmode="numeric" autocomplete="off" value="' + esc(visaPostnr(forval.postnummer)) + '"></div>' +
    '</div>' +
    '<div class="field"><label for="mPostort">Postort</label><input id="mPostort" type="text" placeholder="Västerås" autocomplete="off" value="' + esc(forval.postort || '') + '"></div>' +
    omradesVal +
    '<div class="err" id="mFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="mAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="mNasta">Fortsätt</button></div>');

  delaVidInmatning('mGata', 'mNummer', 'mPostort', 'mPostnummer');

  // Kom man hit för att husnumret saknades ska markören stå i det fältet.
  if (forval.gata && !forval.nummer) $('mNummer').focus();

  $('mAvbryt').onclick = () => stangPanel('dorr');
  $('mNasta').onclick = async () => {
    // Har hela adressen skrivits i gatufältet delas den upp här också,
    // för den som trycker direkt utan att lämna fältet.
    const delad = delaAdress($('mGata').value);
    const gata = (delad.nummer ? delad.gata : $('mGata').value).trim();
    const nummer = ($('mNummer').value || delad.nummer || '').trim();
    const postort = ($('mPostort').value || delad.postort || '').trim();
    const postnr = ($('mPostnummer').value || delad.postnummer || '').replace(/\D/g, '');
    if (!gata || !nummer) { $('mFel').textContent = 'Fyll i gata och husnummer.'; return; }
    if (postnr && postnr.length !== 5) {
      $('mFel').textContent = 'Postnumret ska vara fem siffror, t.ex. 721 34.';
      return;
    }

    $('mNasta').textContent = 'Hämtar…';
    try {
      const lage = forval.lat !== undefined ? { lat: forval.lat, lon: forval.lon }
        : (S.position ? { lat: S.position.lat, lon: S.position.lon } : {});
      const svar = await anrop('adress-ny', {
        gata,
        nummer,
        postnummer: postnr || undefined,
        postort,
        omrade_id: $('mOmrade') ? $('mOmrade').value || undefined : undefined,
        ...lage,
      });
      if (svar.fanns) toast('Adressen fanns redan — öppnar den');
      dataAndrad();
      // Från kartan vill man välja utfall, från knappen Manuell bokning
      // är kunden redan bokad och då öppnas bokningsformuläret direkt.
      oppna(svar.adress.id, !forval.lat);
    } catch (e) {
      $('mNasta').textContent = 'Fortsätt';
      $('mFel').textContent = e.message;
    }
  };
}
