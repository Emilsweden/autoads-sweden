/** Startpunkt: inloggning, navigering, GPS och automatisk uppdatering. */

import { anrop, ApiFel, bas, sattBas, token, sattToken, ko, tommeKo } from './api.js';
import { VERSION } from '../config.js';
import { $, esc, toast, oppnaPanel, stangPanel, kopplaStangning, idag } from './ui.js';
import { S, buss, arRoll, dataAndrad } from './state.js';
import * as karta from './karta.js';
import { manuell as manuellBokning } from './dorr.js';
import * as listor from './listor.js';
import * as dashboard from './dashboard.js';
import * as admin from './admin.js';

const IKONER = {
  karta: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bokningar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  dashboard: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};

const VYER = {
  karta: 'Karta',
  lista: 'Dörrar',
  bokningar: 'Bokningar',
  dashboard: 'Dashboard',
  admin: 'Admin',
};

let dashTimer = null;

/* ══ Navigering ══ */

function ritaNav() {
  const vyer = Object.keys(VYER).filter((v) => v !== 'admin' || arRoll('teamleader'));
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
  if (vy === 'karta') karta.visa();
  if (vy === 'lista') listor.ritaLista();
  if (vy === 'bokningar') listor.ritaBokningar();
  if (vy === 'admin') admin.rita();
  if (vy === 'dashboard') {
    dashboard.rita();
    // Live-läge: dashboarden håller sig aktuell på kontorsskärmen.
    dashTimer = setInterval(() => { if (!document.hidden) dashboard.rita(); }, 30000);
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
  ['omradeVal', 'dOmrade'].forEach((id) => {
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
  const antal = await tommeKo();
  if (antal) {
    toast(antal + ' köade dörrbesök skickades');
    await laddaDorrar();
    dataAndrad();
  }
  visaKo();
}

let positionTimer = null;
function startaGps() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (p) => {
      S.position = { lat: p.coords.latitude, lon: p.coords.longitude };
      karta.egenPosition(S.position.lat, S.position.lon);
    },
    () => { /* säljaren kan ha nekat platsdelning — appen fungerar ändå */ },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
  );

  clearInterval(positionTimer);
  positionTimer = setInterval(() => {
    if (S.position) anrop('position', S.position).catch(() => {});
  }, 60000);
}

/* ══ Profil ══ */

function visaProfil() {
  const a = S.anvandare;
  const roller = { admin: 'Administratör', teamleader: 'Teamleader', saljare: 'Säljare' };
  oppnaPanel('modal',
    '<h2>' + esc(a.namn) + '</h2><p class="sub">' + esc(a.epost) + ' · ' + esc(roller[a.roll] || a.roll) + '</p>' +
    '<h3>Server</h3><div class="field"><input id="pServer" type="url" value="' + esc(bas()) + '"></div>' +
    '<h3>Byt lösenord</h3>' +
    '<div class="field"><label for="pGammalt">Nuvarande</label><input id="pGammalt" type="password"></div>' +
    '<div class="field"><label for="pNytt">Nytt (minst 8 tecken)</label><input id="pNytt" type="password"></div>' +
    '<div class="err" id="pFel"></div>' +
    '<button class="btn btn-ghost" id="pByt">Spara nytt lösenord</button>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="pStang">Stäng</button>' +
    '<button class="btn btn-primary" id="pUt">Logga ut</button></div>');

  $('pServer').onchange = () => { sattBas($('pServer').value); toast('Serveradress sparad'); };
  $('pByt').onclick = async () => {
    try {
      await anrop('byt-losenord', { gammalt: $('pGammalt').value, nytt: $('pNytt').value });
      toast('Lösenordet är bytt');
      stangPanel('modal');
    } catch (e) { $('pFel').textContent = e.message; }
  };
  $('pStang').onclick = () => stangPanel('modal');
  $('pUt').onclick = loggaUt;
}

async function loggaUt() {
  try { await anrop('logga-ut'); } catch (e) { /* spelar ingen roll */ }
  sattToken('');
  S.anvandare = null;
  stangPanel('modal');
  $('app').hidden = true;
  $('login').hidden = false;
}

/* ══ Inloggning ══ */

function visaServerfalt() {
  // Serveradressen kan följa med i länken, så att säljarna slipper knappa in
  // den på telefonen: /falt/?server=https://...workers.dev
  const franLank = new URLSearchParams(location.search).get('server');
  const giltig = franLank && /^https:\/\/[^\s]+$|^http:\/\/localhost(:\d+)?$/.test(franLank)
    ? franLank.replace(/\/+$/, '') : '';

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
  if ($('lServer')) sattBas($('lServer').value);
  $('lFel').textContent = '';
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

  fyllOmradesval();
  dashboard.koppla();
  listor.kopplaBokningar(arRoll('teamleader') ? (await hamtaSaljare()) : [S.anvandare]);
  await laddaDorrar();
  visaVy(arRoll('teamleader') ? 'dashboard' : 'karta');
  startaGps();
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
$('omradeVal').addEventListener('change', async (ev) => {
  S.valtOmrade = ev.target.value;
  await laddaDorrar();
  if (S.vy === 'karta') karta.rita(); else listor.ritaLista();
});

listor.kopplaLista();
admin.koppla();
kopplaStangning();

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
