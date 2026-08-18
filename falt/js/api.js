/** Anrop mot fältsystemets API, med kö för registreringar gjorda utan täckning. */

import { STANDARD_SERVER } from '../config.js';

const NYCKEL_BAS = 'falt_server';
const NYCKEL_TOKEN = 'falt_token';
const NYCKEL_KO = 'falt_ko';

export function bas() {
  // Sparad adress vinner, annars den servern appen levereras tillsammans med.
  return (localStorage.getItem(NYCKEL_BAS) || STANDARD_SERVER || '').replace(/\/+$/, '');
}
export function sattBas(url) {
  localStorage.setItem(NYCKEL_BAS, (url || '').trim().replace(/\/+$/, ''));
}
export function token() {
  return localStorage.getItem(NYCKEL_TOKEN) || '';
}
export function sattToken(t) {
  if (t) localStorage.setItem(NYCKEL_TOKEN, t);
  else localStorage.removeItem(NYCKEL_TOKEN);
}

/**
 * Ett misslyckat anrop ser likadant ut oavsett orsak, så det här pekar ut
 * de vanliga fällorna: fel webbadress för appen, eller http i stället för https.
 */
function varforInteKontakt() {
  const harifran = location.origin;
  const tillaten = /^https:\/\/(www\.)?autoads\.se$/.test(harifran) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(harifran);

  if (location.protocol === 'https:' && bas().startsWith('http://')) {
    return 'Serveradressen måste börja med https:// när appen körs över https.';
  }
  if (!tillaten) {
    return 'Appen är öppnad från ' + harifran + ', men servern tar bara emot anrop från autoads.se. ' +
      'Öppna appen på https://autoads.se/falt/ i stället.';
  }
  return 'Kontrollera serveradressen och att telefonen har internet.';
}

export class ApiFel extends Error {
  constructor(meddelande, status, data) {
    super(meddelande);
    this.status = status;
    this.data = data;
  }
}

/** Skickar ett anrop. Kastar ApiFel vid fel; status 0 betyder att nätet inte gick att nå. */
export async function anrop(namn, data = {}) {
  if (!bas()) throw new ApiFel('Ingen serveradress angiven', 0);

  let svar;
  try {
    svar = await fetch(bas() + '/api/' + namn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
      },
      body: JSON.stringify(data),
    });
  } catch (e) {
    throw new ApiFel('Ingen kontakt med servern. ' + varforInteKontakt(), 0);
  }

  const kropp = await svar.json().catch(() => ({}));
  if (!svar.ok || !kropp.ok) {
    // Spärrad dörr svarar 409 med detaljer om det tidigare besöket.
    let detaljer = null;
    if (svar.status === 409) { try { detaljer = JSON.parse(kropp.fel); } catch (e) { /* vanligt fel */ } }
    throw new ApiFel(detaljer ? 'Dörren är nyligen bearbetad' : (kropp.fel || 'Fel ' + svar.status), svar.status, detaljer);
  }
  return kropp;
}

/* ── Kö för dörrbesök registrerade utan täckning ── */

export function ko() {
  try { return JSON.parse(localStorage.getItem(NYCKEL_KO) || '[]'); } catch (e) { return []; }
}
function sparaKo(k) {
  localStorage.setItem(NYCKEL_KO, JSON.stringify(k.slice(0, 500)));
}
export function laggIKo(data) {
  const k = ko();
  k.push({ ...data, ko_tid: Date.now() });
  sparaKo(k);
}

/**
 * Skickar upp köade dörrbesök. Returnerar antalet som gick igenom.
 * Poster som servern avvisar med ett riktigt fel slängs, annars fastnar kön.
 */
export async function tommeKo() {
  let k = ko();
  if (!k.length || !bas() || !token()) return 0;
  let skickade = 0;

  while (k.length) {
    const post = k[0];
    try {
      await anrop('handelse', { ...post, bekrafta: true });
      skickade++;
    } catch (e) {
      if (e.status === 0) break;       // fortfarande utan täckning — behåll kön
      if (e.status === 401) break;     // utloggad — försök igen efter inloggning
    }
    k = ko().slice(1);
    sparaKo(k);
  }
  return skickade;
}
