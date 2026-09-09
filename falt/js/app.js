/** Startpunkt: inloggning, navigering, GPS och automatisk uppdatering. */

import { anrop, ApiFel, bas, sattBas, token, sattToken, ko, tommeKo } from './api.js';
import { VERSION, STANDARD_SERVER } from '../config.js';
import { $, esc, toast, oppnaPanel, stangPanel, kopplaStangning, kopplaLayout } from './ui.js';
import { S, buss, arRoll, kan, dataAndrad } from './state.js';
import * as karta from './karta.js';
import { manuell as manuellBokning } from './dorr.js';
import { visaImport as visaAnteckningar } from './anteckningar.js';
import * as listor from './listor.js';
import * as kalender from './kalender.js';
import * as bokade from './bokade.js';
import * as tider from './tider.js';
import * as flode from './flode.js';
import * as dashboard from './dashboard.js';
import * as admin from './admin.js';

const IKONER = {
  karta: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
  lista: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
    '<path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  bokningar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  dashboard: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  nyheter: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Z"/>' +
    '<path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};

/* Ordningen är den i bottenmenyn. Admin ligger inte där — den nås via
   profilen, så att fältvyerna får hela bredden. Översikten är tills vidare
   borta ur menyn och har lämnat plats åt Nyheter; koden står kvar. */
const VYER = {
  karta: 'Karta',
  bokningar: 'Bokningar',
  lista: 'Kunder',
  nyheter: 'Nyheter',
  dashboard: 'Översikt',
  admin: 'Admin',
};
const NAVVYER = ['karta', 'bokningar', 'lista', 'nyheter'];

let dashTimer = null;

/* ══ Navigering ══ */

function ritaNav() {
  // Den som inte knackar dörrar har ingen karta, inget register och ingen
  // topplista — bara bokningarna. Servern säger samma sak.
  const vyer = kan('knacka') ? NAVVYER : ['bokningar', 'nyheter'];
  $('botten').innerHTML = vyer.map((v) =>
    '<button data-vy="' + v + '" class="' + (v === S.vy ? 'aktiv' : '') + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    IKONER[v] + '</svg>' + VYER[v] + '</button>').join('');

  $('botten').querySelectorAll('button').forEach((b) => {
    b.onclick = () => visaVy(b.dataset.vy);
  });
}

export function visaVy(vy) {
  S.vy = vy;
  Object.keys(VYER).forEach((v) => { $('vy-' + v).hidden = v !== vy; });
  $('vyTitel').textContent = VYER[vy];
  $('vySub').textContent = '';
  ritaNav();

  clearInterval(dashTimer);
  if (vy !== 'bokningar') kalender.stoppa();
  if (vy === 'karta') karta.visa();
  if (vy === 'lista') listor.ritaLista();
  if (vy === 'bokningar') visaBokningsflik();
  if (vy === 'nyheter') flode.rita();
  if (vy === 'admin') admin.rita();
  if (vy === 'dashboard') {
    dashboard.rita();
    // Live-läge: dashboarden håller sig aktuell på kontorsskärmen.
    dashTimer = setInterval(() => { if (!document.hidden) dashboard.rita(); }, 30000);
  }
}

/**
 * Bokningsvyns flikar. Vilka som finns beror på rollen: mötesbokaren har
 * kalender, sina bokningar, listan och flödet; säljaren sina möten och sina
 * tider; Admin Säljare allas tider.
 */
let bokFlik = 'kalender';

function bokFlikar() {
  const saljare = S.anvandare && S.anvandare.roll === 'besiktare';
  const flikar = [['kalender', 'Kalender'], ['bokade', saljare ? 'Mina möten' : 'Bokade adresser']];
  if (kan('knacka')) flikar.push(['lista', 'Lista']);
  if (kan('styr_tider') || kan('eget_schema')) {
    flikar.push(['tider', kan('styr_tider') ? 'Besiktarnas tider' : 'Mina tider']);
  }
  return flikar;
}

function visaBokningsflik() {
  const flikar = bokFlikar();
  if (!flikar.some(([k]) => k === bokFlik)) bokFlik = flikar[0][0];

  $('bokFlikar').innerHTML = flikar.map(([k, t]) =>
    '<button class="flik' + (k === bokFlik ? ' aktiv' : '') + '" data-bok="' + k + '">' +
    esc(t) + '</button>').join('');
  $('bokFlikar').querySelectorAll('[data-bok]').forEach((f) => {
    f.onclick = () => { bokFlik = f.dataset.bok; visaBokningsflik(); };
  });

  $('kalenderInnehall').hidden = bokFlik !== 'kalender';
  $('bokadeInnehall').hidden = bokFlik !== 'bokade';
  $('bokningsLista').hidden = bokFlik !== 'lista';
  $('tiderInnehall').hidden = bokFlik !== 'tider';

  if (bokFlik === 'kalender') { kalender.starta(); return; }
  kalender.stoppa();
  if (bokFlik === 'bokade') bokade.rita();
  else if (bokFlik === 'tider') tider.rita();
  else listor.ritaBokningar();
}

/* ══ Puls: håll alla i laget på samma bild ══ */

/*
 * Ett litet anrop var tolfte sekund som bara frågar "har något hänt?".
 * Har det det hämtar den vy som syns om sig själv, så att en bokning eller
 * en ändrad tid dyker upp hos de andra utan att någon laddar om.
 */
const PULS_MS = 12000;
let pulsTimer = null;
let senastePuls = 0;

function startaPuls() {
  clearInterval(pulsTimer);
  pulsTimer = setInterval(kollaPuls, PULS_MS);
  kollaPuls();
}

function stoppaPuls() {
  clearInterval(pulsTimer);
  pulsTimer = null;
  senastePuls = 0;
}

async function kollaPuls() {
  if (document.hidden || !S.anvandare) return;
  let svar;
  try {
    svar = await anrop('puls', {});
  } catch (e) {
    return;   // utan täckning är tystnad rätt svar
  }
  if (!svar || !svar.senast) return;
  if (!senastePuls) { senastePuls = svar.senast; return; }
  if (svar.senast <= senastePuls) return;
  senastePuls = svar.senast;
  uppdateraSynligt();
}

/** Hämtar om det som faktiskt syns — inte allt. */
function uppdateraSynligt() {
  if (S.vy === 'nyheter') {
    flode.rita();
  } else if (S.vy === 'bokningar') {
    if (bokFlik === 'bokade') bokade.rita();
    else if (bokFlik === 'tider') tider.rita();
    else if (bokFlik === 'lista') listor.ritaBokningar();
    // Kalendern har en egen hämtning som redan går medan den syns.
  } else if (S.vy === 'karta' || S.vy === 'lista') {
    laddaDorrar().then(() => dataAndrad());
  } else if (S.vy === 'dashboard') {
    dashboard.rita();
  }
}

/* ══ Data ══ */

async function laddaDorrar() {
  try {
    const data = await anrop('adresser', { omrade_id: S.valtOmrade || undefined });
    S.adresser = data.adresser || [];
    S.omraden = data.omraden || S.omraden;
    fyllOmradesval();
  } catch (e) {
    if (e.status === 401) return loggaUt();
    toast('Kunde inte hämta dörrar: ' + e.message);
  }
}

function fyllOmradesval() {
  const val = ['<option value="">Alla områden</option>']
    .concat(S.omraden.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.namn) + '</option>'));
  ['omradeVal', 'lOmrade', 'dOmrade'].forEach((id) => {
    const el = $(id);
    const tidigare = el.value;
    el.innerHTML = val.join('');
    el.value = tidigare || S.valtOmrade || '';
  });
}

/* ══ Kö och GPS ══ */

function visaKo() {
  const antal = ko().length;
  $('koPill').hidden = antal === 0;
  $('koTxt').textContent = antal + ' väntar';
}

async function skickaKo() {
  const { skickade, utanTid } = await tommeKo();
  if (skickade) {
    toast(skickade + ' köade dörrbesök skickades' +
      (utanTid ? ' — ' + utanTid + ' bokning fick ingen tid, tiden var tagen' : ''));
    await laddaDorrar();
    dataAndrad();
  }
  visaKo();
}

let positionTimer = null;
let farskTimer = null;
const SENASTE_POSITION = 'falt_position';

function gpsRad(text, klass) {
  const el = $('gpsRad');
  if (!el) return;
  el.textContent = text;
  el.className = 'gps-rad' + (klass ? ' ' + klass : '');
}

const klockan = (ms) => new Date(ms).toTimeString().slice(0, 5);

/**
 * Positionen ska vara stabil ute på fältet: senast kända läge visas direkt
 * vid start, uppdateringar sker löpande, och tappas signalen står punkten
 * kvar — gråad — i stället för att försvinna.
 */
function startaGps() {
  // Senast kända position visas medan den första fixen hämtas.
  try {
    const sparad = JSON.parse(localStorage.getItem(SENASTE_POSITION) || 'null');
    if (sparad && sparad.lat) {
      S.position = { lat: sparad.lat, lon: sparad.lon };
      karta.egenPosition(sparad.lat, sparad.lon);
      karta.gammalPosition();
      gpsRad('Senast kända position ' + klockan(sparad.tid), 'soker');
    }
  } catch (e) { /* inget sparat läge */ }

  if (!navigator.geolocation) { gpsRad('Telefonen delar ingen position', 'av'); return; }
  gpsRad('GPS söker signal…', 'soker');

  navigator.geolocation.watchPosition(
    (p) => {
      S.position = { lat: p.coords.latitude, lon: p.coords.longitude, noggrannhet: p.coords.accuracy };
      S.positionTid = Date.now();
      localStorage.setItem(SENASTE_POSITION, JSON.stringify({ ...S.position, tid: S.positionTid }));
      karta.egenPosition(S.position.lat, S.position.lon);
      gpsRad('Position uppdaterad ' + klockan(S.positionTid) +
        (p.coords.accuracy ? ' · ±' + Math.round(p.coords.accuracy) + ' m' : ''));
    },
    (e) => {
      // 1 = nekad. Övriga är tillfälliga: behåll senaste läget och säg till.
      if (e && e.code === 1) {
        gpsRad('Platsdelning är avstängd — slå på den för telefonen och appen', 'av');
      } else {
        karta.gammalPosition();
        gpsRad('GPS söker signal…' + (S.positionTid ? ' Senast ' + klockan(S.positionTid) : ''), 'soker');
      }
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
  );

  // Kommer inga uppdateringar alls är läget inte längre färskt.
  clearInterval(farskTimer);
  farskTimer = setInterval(() => {
    if (!S.positionTid || Date.now() - S.positionTid < 90000) return;
    karta.gammalPosition();
    gpsRad('GPS söker signal… Senast ' + klockan(S.positionTid), 'soker');
  }, 30000);

  clearInterval(positionTimer);
  positionTimer = setInterval(() => {
    if (S.position) anrop('position', S.position).catch(() => {});
  }, 60000);
}

/* ══ Profil ══ */

function visaProfil() {
  const a = S.anvandare;
  oppnaPanel('modal',
    '<h2>' + esc(a.namn) + '</h2><p class="sub">' + esc(a.epost) + ' · ' +
    esc(a.rollnamn || a.roll) + '</p>' +
    '<h3>Server</h3><div class="field"><input id="pServer" type="url" value="' + esc(bas()) + '"></div>' +
    '<h3>Byt lösenord</h3>' +
    '<div class="field"><label for="pGammalt">Nuvarande</label><input id="pGammalt" type="password"></div>' +
    '<div class="field"><label for="pNytt">Nytt (minst 8 tecken)</label><input id="pNytt" type="password"></div>' +
    '<div class="err" id="pFel"></div>' +
    '<button class="btn btn-ghost" id="pByt">Spara nytt lösenord</button>' +
    (arRoll('teamleader') || kan('se_personal')
      ? '<h3>Administration</h3><button class="btn btn-ghost" id="pAdmin">' +
        (arRoll('teamleader') ? 'Områden, användare och regler' : 'Laget och kontona') + '</button>'
      : '') +
    '<div class="btn-rad"><button class="btn btn-ghost" id="pStang">Stäng</button>' +
    '<button class="btn btn-primary" id="pUt">Logga ut</button></div>');

  $('pServer').onchange = () => {
    if (!serverTillaten($('pServer').value)) {
      $('pServer').value = bas();
      toast('Okänd serveradress — den ändrades inte');
      return;
    }
    sattBas($('pServer').value);
    toast('Serveradress sparad');
  };
  $('pByt').onclick = async () => {
    try {
      // Bytet loggar ut alla telefoner, även den här — servern skickar
      // tillbaka en ny session så att du får fortsätta där du är.
      const svar = await anrop('byt-losenord', { gammalt: $('pGammalt').value, nytt: $('pNytt').value });
      if (svar && svar.token) sattToken(svar.token);
      toast('Lösenordet är bytt — övriga telefoner loggades ut');
      stangPanel('modal');
    } catch (e) { $('pFel').textContent = e.message; }
  };
  if ($('pAdmin')) $('pAdmin').onclick = () => { stangPanel('modal'); visaVy('admin'); };
  $('pStang').onclick = () => stangPanel('modal');
  $('pUt').onclick = loggaUt;
}

async function loggaUt() {
  stoppaPuls();
  flode.nollstall();
  try { await anrop('logga-ut'); } catch (e) { /* spelar ingen roll */ }
  sattToken('');
  S.anvandare = null;
  stangPanel('modal');
  $('app').hidden = true;
  $('login').hidden = false;
}

/* ══ Inloggning ══ */

/**
 * Servrar appen får prata med. Listan är avsiktligt kort: en länk får peka
 * på den server appen levererades från eller den som står i config.js, inget
 * annat. Utan den kunde ?server=https://... i en länk styra om inloggningen
 * till en främmande sajt, som då fick både e-post och lösenord i klartext.
 */
function tillatnaServrar() {
  const lista = [STANDARD_SERVER];
  if (location.protocol === 'https:' || location.hostname === 'localhost') lista.push(location.origin);
  return lista
    .filter(Boolean)
    .map((a) => a.trim().replace(/\/+$/, '').toLowerCase());
}

/** Sant bara för exakt samma ursprung som någon av de tillåtna adresserna. */
export function serverTillaten(url) {
  let adress;
  try {
    adress = new URL(String(url || '').trim());
  } catch (e) {
    return false;
  }
  if (adress.protocol !== 'https:' && adress.hostname !== 'localhost') return false;
  const rensad = (adress.origin + adress.pathname).replace(/\/+$/, '').toLowerCase();
  return tillatnaServrar().includes(rensad);
}

function visaServerfalt() {
  // Serveradressen kan följa med i länken, så att säljarna slipper knappa in
  // den på telefonen: /falt/?server=https://...workers.dev — men bara till en
  // adress appen redan känner till.
  const franLank = (new URLSearchParams(location.search).get('server') || '').trim();
  const giltig = franLank && serverTillaten(franLank) ? franLank.replace(/\/+$/, '') : '';
  if (franLank && !giltig) {
    $('lFel').textContent = 'Länken pekar på en okänd server och används inte.';
  }

  // Med en standardserver i config.js behöver ingen ange adressen alls;
  // fältet visas bara om den saknas eller om en annan skickats med i länken.
  if (bas() && !giltig) return;

  if (!$('lServer')) {
    const falt = document.createElement('div');
    falt.className = 'field';
    falt.innerHTML = '<label for="lServer">Serveradress</label>' +
      '<input id="lServer" type="url" placeholder="https://autoads-falt.workers.dev" autocapitalize="off" spellcheck="false">';
    $('loginForm').insertBefore(falt, $('loginForm').firstChild);
  }

  // Adressen fylls bara i, den sparas först när du loggar in — så att du
  // alltid ser vilken server du är på väg att skicka lösenordet till.
  $('lServer').value = giltig || bas();
}

/**
 * Kontrollerar anslutningen steg för steg och skriver ut vad som händer.
 * Finns för att ett misslyckat anrop annars inte säger något alls om orsaken.
 */
async function testaAnslutning() {
  const ruta = $('testaSvar');
  ruta.hidden = false;
  ruta.textContent = 'Testar…';

  const rader = [
    'Version: ' + VERSION,
    'Sida: ' + location.origin,
    'Server: ' + (bas() || '(saknas)'),
    'Uppkopplad enligt telefonen: ' + (navigator.onLine ? 'ja' : 'nej'),
  ];

  try {
    const r = await fetch(bas() + '/halsa', { cache: 'no-store' });
    rader.push('1. Hämta /halsa: ' + r.status + ' ' + (r.ok ? 'OK' : 'fel'));
  } catch (e) {
    rader.push('1. Hämta /halsa: MISSLYCKADES — ' + e.name + ': ' + e.message);
  }

  try {
    const r = await fetch(bas() + '/api/logga-in', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '{}',
    });
    rader.push('2. Skicka POST: ' + r.status + (r.status === 400 ? ' (väntat — tomt formulär)' : ''));
  } catch (e) {
    rader.push('2. Skicka POST: MISSLYCKADES — ' + e.name + ': ' + e.message);
  }

  ruta.textContent = rader.join('\n');
}

async function loggaIn(ev) {
  ev.preventDefault();
  $('lFel').textContent = '';
  // Lösenordet skickas till den adress som står i fältet — därför får den
  // adressen inte vara vad som helst.
  if ($('lServer') && $('lServer').value.trim() && $('lServer').value.trim() !== bas()) {
    if (!serverTillaten($('lServer').value)) {
      $('lFel').textContent = 'Okänd serveradress. Lämna fältet som det är, eller fråga administratören.';
      return;
    }
    sattBas($('lServer').value);
  }
  $('lKnapp').textContent = 'Loggar in…';

  try {
    const data = await anrop('logga-in', { epost: $('lEpost').value.trim(), losenord: $('lLosen').value });
    sattToken(data.token);
    await start();
  } catch (e) {
    $('lFel').textContent = e.message;
  } finally {
    $('lKnapp').textContent = 'Logga in';
  }
}

/* ══ Start ══ */

async function start() {
  let mig;
  try {
    mig = await anrop('jag');
  } catch (e) {
    sattToken('');
    $('login').hidden = false;
    $('app').hidden = true;
    visaServerfalt();
    if (e.status && e.status !== 401) $('lFel').textContent = e.message;
    return;
  }

  S.anvandare = mig.anvandare;
  S.installningar = mig.installningar || {};
  S.omraden = mig.omraden || [];

  $('login').hidden = true;
  $('app').hidden = false;
  $('initialer').textContent = (S.anvandare.namn || '?')
    .split(/\s+/).slice(0, 2).map((d) => d[0]).join('').toUpperCase();

  matLayout();
  dashboard.koppla();

  // Den som inte knackar dörrar har varken karta eller adressregister —
  // servern säger nej till dem, så appen frågar inte heller efter dem.
  if (!kan('knacka')) {
    bokFlik = S.anvandare.roll === 'besiktare' ? 'bokade' : 'kalender';
    visaVy('nyheter');
    startaPuls();
    skickaKo();
    return;
  }

  fyllOmradesval();
  listor.kopplaBokningar(kan('allt_bokat') ? (await hamtaSaljare()) : [S.anvandare]);
  await laddaDorrar();
  visaVy('karta');
  startaGps();
  startaPuls();
  skickaKo();
}

async function hamtaSaljare() {
  try { return (await anrop('anvandare-lista')).anvandare || []; } catch (e) { return []; }
}

/* ══ Koppling ══ */

$('loginForm').addEventListener('submit', loggaIn);
$('profilKnapp').addEventListener('click', visaProfil);
$('koPill').addEventListener('click', skickaKo);
$('nastaDorr').addEventListener('click', karta.nastaDorr);
['manuellDorr', 'manuellDorr2'].forEach((id) => {
  $(id).addEventListener('click', () => manuellBokning(S.omraden, S.valtOmrade));
});
$('anteckningarKnapp').addEventListener('click', () => visaAnteckningar(S.omraden, S.valtOmrade));
// Områdesvalet finns i både kartan och listan och ska följas åt.
['omradeVal', 'lOmrade'].forEach((id) => {
  $(id).addEventListener('change', async (ev) => {
    S.valtOmrade = ev.target.value;
    ['omradeVal', 'lOmrade'].forEach((annat) => { $(annat).value = S.valtOmrade; });
    await laddaDorrar();
    if (S.vy === 'karta') karta.rita(); else listor.ritaLista();
  });
});

$('bokFlikar').addEventListener('click', (ev) => {
  const f = ev.target.closest('.flik');
  if (!f) return;
  bokFlik = f.dataset.bok;
  visaBokningsflik();
});

karta.kopplaSok();
listor.kopplaLista();
admin.koppla();
kopplaStangning();
const matLayout = kopplaLayout();

buss.addEventListener('data', async () => {
  await laddaDorrar();
  if (S.vy === 'karta') karta.rita();
  if (S.vy === 'lista') listor.ritaLista();
  if (S.vy === 'dashboard') dashboard.rita();
  visaKo();
});

window.addEventListener('online', skickaKo);
setInterval(skickaKo, 30000);
setInterval(() => { if (!document.hidden && S.anvandare && S.vy !== 'dashboard') laddaDorrar(); }, 45000);

$('appVersion').textContent = 'Version ' + VERSION;
$('testaKnapp').addEventListener('click', testaAnslutning);
visaKo();
visaServerfalt();
if (token() && bas()) start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
