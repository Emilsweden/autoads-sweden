/**
 * Kartvyn — alla dörrar i området som färgade punkter, plus säljarnas position.
 *
 * Vilken karta som ritar — Googles eller OpenStreetMap-kartan — avgörs i
 * kartmotor.js. Här finns det kartan gör: dörrarna, husnumren, trycken,
 * sökningen och positionerna, samma kod oavsett motor.
 */

import { anrop } from './api.js';
import { $, esc, toast, STATUS_FARG, STATUS_TEXTFARG, visaTidpunkt } from './ui.js';
import { S, arRoll, dataAndrad } from './state.js';
import { oppna as oppnaDorr, manuell as manuellDorr } from './dorr.js';
import { adressVid, husIRuta, sokAdress } from './geo.js';
import { valjMotor } from './kartmotor.js';

let motor = null;
let skapas = null;            // pågående start, så att kartan bara skapas en gång
let jagMarkor = null;
let saljarMarkorer = [];
let harCentrerat = false;
let centreratOmrade = null;   // vilket urval kartan senast zoomade till
let kartrutorFel = false;     // kartbilden kunde inte hämtas (nät/brandvägg)
let laddad = false;

// Positionen kan komma innan kartan finns — Googles karta tar en stund att
// ladda. Den sparas och ritas ut när kartan är klar i stället för att tappas.
let senastePosition = null;
let positionGammal = false;

const VASTERAS = { lon: 16.5448, lat: 59.6099 };

/** Knapp som hoppar till säljarens egen position. */
function positionsKnapp() {
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.className = 'kartknapp-jag';
  knapp.title = 'Min position';
  knapp.setAttribute('aria-label', 'Min position');
  knapp.textContent = '◎';
  knapp.onclick = () => {
    if (!S.position) { toast('Ingen position ännu — tillåt platsdelning'); return; }
    motor.flyg(S.position.lon, S.position.lat, Math.max(motor.zoom(), 17));
  };
  return knapp;
}

/** Skapar kartan första gången den visas. Anrop under tiden väntar på samma start. */
function skapa() {
  if (motor) return Promise.resolve();
  if (!skapas) skapas = starta({}).finally(() => { skapas = null; });
  return skapas;
}

async function starta(val) {
  const behallare = $('karta');
  let m = null;
  try {
    m = await valjMotor(behallare, { ...VASTERAS, zoom: 13 }, { ...val, vidFel: bytTillReserv });
  } catch (e) {
    console.error('Kartan kunde inte skapas:', e);
  }
  if (!m) {
    // Kartbiblioteket kunde inte hämtas (t.ex. helt utan täckning).
    // Resten av appen ska fungera ändå — dörrarna finns i listvyn.
    behallare.innerHTML =
      '<div class="tom">Kartan kunde inte laddas.<br>Dörrarna finns kvar under <b>Dörrar</b>.</div>';
    return;
  }
  koppla(m);
}

function koppla(m) {
  motor = m;
  $('karta').dataset.motor = m.namn;
  // Kartan exponeras för felsökning och för de automatiska proven.
  window.__karta = m.karta;
  window.__kartmotor = m;

  m.knapp(positionsKnapp());
  m.vidKartbildFel((fel) => { kartrutorFel = fel; uppdateraBanner(); });
  m.nar('klick', vidKartklick);
  m.nar('rorelseslut', ritaNummer);
  m.nar('vila', () => { ritaNummer(); hamtaHus(); });
  m.klar(() => {
    laddad = true;
    rita();
    ritaPosition();
  });

  const teckenruta = $('teckenforklaring');
  if (teckenruta) teckenruta.innerHTML =
    '<span><i style="background:#fff;border:2px solid #1a73e8"></i>Ej registrerat (husnummer)</span>' +
    [['ejbesokt', 'Ej besökt'], ['bokat', 'Bokad'], ['ejsvar', 'Inget svar'],
      ['aterkom', 'Återkom'], ['nej', 'Nej'], ['sparrad', 'Nyligen besökt'],
    ].map(([k, t]) => '<span><i style="background:' + STATUS_FARG[k] +
      ';border:1px solid ' + (k === 'ejbesokt' ? '#0d0d0d' : 'rgba(0,0,0,0.15)') + '"></i>' + t + '</span>').join('');
}

/**
 * Googles karta slutade fungera mitt i passet — kvoten är slut eller nyckeln
 * spärrad. Då tar OpenStreetMap-kartan över. Allt som hörde till den gamla
 * kartan släpps och ritas upp igen på den nya. Aldrig åt andra hållet: en
 * karta som byts under tummen är värre än en som ser annorlunda ut.
 */
async function bytTillReserv() {
  if (!motor || motor.namn !== 'google') return;
  const gammal = motor;
  motor = null;
  laddad = false;
  brickor.clear();
  jagMarkor = null;
  saljarMarkorer = [];
  popp = null;
  centreratOmrade = null;
  harCentrerat = false;
  gammal.forstor();
  await starta({ baraReserv: true });
  if (motor && S.vy === 'karta') {
    motor.omrakna();
    if (arRoll('teamleader')) ritaSaljare();
  }
}

/* ── Husnummer som brickor ── */

const NUMMER_ZOOM = 14;     // längre ut blir numren oläsliga
const MAX_NUMMER = 150;     // fler brickor än så blir en vägg av siffror
const BRICKA = 28;          // brickans storlek i bildpunkter

const brickor = new Map();  // adress-id → markör

/**
 * Ritar husnumret på varje hus i vyn. Numret är det man känner igen huset
 * på ute på gatan, så det är markören — inte en generisk kartnål.
 * Längre ut visas i stället färgade punkter, annars blir kartan full.
 */
/**
 * Ritar husnumren för de hus vi ännu inte registrerat. Registrerade dörrar
 * har sin färgade punkt — deras nummer skulle bara skymma statusen.
 */
function ritaNummer() {
  if (!motor || !laddad) return;

  const okanda = motor.zoom() >= NUMMER_ZOOM ? okandaHusIVy() : [];
  if (!okanda.length) {
    brickor.forEach((m) => m.bort());
    brickor.clear();
    return;
  }

  const kvar = new Set();
  const placerade = [];

  okanda.slice(0, MAX_NUMMER).forEach((h) => {
    const p = motor.pixel(h.lon, h.lat);
    if (!p || placerade.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < BRICKA)) return;
    placerade.push(p);
    kvar.add(h.id);

    const fanns = brickor.get(h.id);
    if (fanns) {
      sattKlasser(fanns.el, 'hus-nummer okand', h.nummer);
      fanns.flytta(h.lon, h.lat);
      return;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hus-nummer okand';
    el.textContent = h.nummer;
    el.title = [h.gata, h.nummer].filter(Boolean).join(' ') + (h.postort ? ', ' + h.postort : '');
    brickor.set(h.id, motor.markor(el, h.lon, h.lat, { klick: () => oppnaOkantHus(h) }));
  });

  brickor.forEach((m, id) => {
    if (kvar.has(id)) return;
    m.bort();
    brickor.delete(id);
  });
}

/* ── Hus från kartan som ingen registrerat än ── */

const husCache = new Map();   // rutnyckel → hus[]
let hamtarHus = false;
let senasteHamtning = 0;
const HAMTA_PAUS = 3000;      // OpenStreetMaps sökserver är gratis — var snäll mot den

/** Kartrutan avrundad till ett rutnät, så samma område hämtas bara en gång. */
function rutnyckel(g) {
  const r = (n) => Math.floor(n * 200) / 200;   // ~500 m
  return [r(g.getSouth()), r(g.getWest()), r(g.getNorth()), r(g.getEast())].join(',');
}

/** Husen i vyn som inte redan finns som dörr hos oss. */
function okandaHusIVy() {
  const g = motor.grans();
  if (!g) return [];
  const hus = husCache.get(rutnyckel(g)) || [];
  if (!hus.length) return [];

  // Lite marginal runt vyn, så brickorna finns innan huset kommer i bild.
  const dLat = (g.getNorth() - g.getSouth()) * 0.3;
  const dLon = (g.getEast() - g.getWest()) * 0.3;

  // En registrerad dörr inom 15 meter är samma hus — då är den redan vår.
  const vara = synligaAdresser();
  return hus.filter((h) =>
    h.lat > g.getSouth() - dLat && h.lat < g.getNorth() + dLat &&
    h.lon > g.getWest() - dLon && h.lon < g.getEast() + dLon &&
    !vara.some((a) => Math.abs(a.lat - h.lat) < 0.00014 && Math.abs(a.lon - h.lon) < 0.00027));
}

/**
 * Hämtar husnumren för det man tittar på. Adresserna finns redan i
 * OpenStreetMap — ingen ska behöva skriva in en gata för hand.
 */
async function hamtaHus() {
  if (!motor || hamtarHus || motor.zoom() < NUMMER_ZOOM) return;
  const g = motor.grans();
  if (!g) return;
  const nyckel = rutnyckel(g);
  if (husCache.has(nyckel)) return;
  if (Date.now() - senasteHamtning < HAMTA_PAUS) {
    setTimeout(hamtaHus, HAMTA_PAUS);
    return;
  }
  senasteHamtning = Date.now();

  hamtarHus = true;
  husStatus('Hämtar husnummer…');
  try {
    const hus = await husIRuta(g.getSouth(), g.getWest(), g.getNorth(), g.getEast());
    husCache.set(nyckel, hus.map((h, i) => ({ ...h, id: 'osm-' + nyckel + '-' + i })));
    husStatus(hus.length ? '' : 'Inga husnummer i kartan här');
    ritaNummer();
  } catch (e) {
    husCache.set(nyckel, []);      // försök inte om och om igen på samma ruta
    husStatus('Kunde inte hämta husnummer');
  } finally {
    hamtarHus = false;
  }
}

let husStatusTimer = null;
function husStatus(text) {
  const el = $('husRad');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(husStatusTimer);
  if (text && !/Hämtar/.test(text)) husStatusTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

/** Meter mellan två punkter, tillräckligt exakt på de här avstånden. */
function meter(lat1, lon1, lat2, lon2) {
  const dLat = (lat1 - lat2) * 111320;
  const dLon = (lon1 - lon2) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Husnumren vi redan hämtat till kartan, närmast punkten först.
 *
 * Det här är poängen med att ha dem: kartans adresstjänst svarar ibland med
 * bara gatunamnet, medan husnumret hela tiden funnits i datan vi hämtade för
 * att kunna rita brickorna. Då ska vi använda det vi har i stället för att
 * be säljaren skriva in ett nummer som appen känner till.
 */
function husNara(lat, lon, maxMeter = 45, max = 6) {
  const alla = [];
  husCache.forEach((hus) => hus.forEach((h) => alla.push(h)));
  return alla
    .map((h) => ({ ...h, avstand: meter(lat, lon, h.lat, h.lon) }))
    .filter((h) => h.avstand <= maxMeter)
    .sort((a, b) => a.avstand - b.avstand)
    .slice(0, max);
}

/**
 * Ett hus från kartan trycks på: adressen är redan känd, så dörren skapas
 * och öppnas direkt — säljaren fyller bara i utfallet.
 */
async function oppnaOkantHus(h) {
  if (!h.gata) {
    manuellDorr(S.omraden, S.valtOmrade, { nummer: h.nummer, lat: h.lat, lon: h.lon });
    return;
  }
  try {
    const svar = await anrop('adress-ny', {
      gata: h.gata,
      nummer: h.nummer,
      postnummer: h.postnummer || undefined,
      postort: h.postort || (S.omraden.find((o) => o.id === S.valtOmrade) || {}).ort || '',
      omrade_id: S.valtOmrade || undefined,
      lat: h.lat,
      lon: h.lon,
    });
    dataAndrad();
    oppnaDorr(svar.adress.id);
  } catch (e) {
    toast('Kunde inte öppna huset: ' + e.message);
  }
}

/**
 * Byter statusklass på en bricka utan att röra kartmotorns egna klasser.
 * MapLibre lägger sina direkt på brickan och sköter positioneringen med
 * dem — skrivs de över faller brickan ur sitt läge och hamnar i en hög med
 * de andra. (Googles karta lägger brickan i en egen ruta och rör den inte.)
 */
function sattKlasser(el, klasser, nummer) {
  const egna = [...el.classList].filter((k) => k.startsWith('maplibregl'));
  const nya = egna.concat(klasser.split(' ')).join(' ');
  if (el.className !== nya) el.className = nya;
  if (el.textContent !== (nummer || '?')) el.textContent = nummer || '?';
}

/** Adresserna i valt område som har ett läge att rita ut. */
function synligaAdresser() {
  return S.adresser.filter((a) =>
    (!S.valtOmrade || a.omrade_id === S.valtOmrade) && a.lat && a.lon);
}

/* ── Tryck på kartan ── */

/**
 * Närmaste dörr räknat i bildpunkter, inte meter: träffytan ska vara lika
 * stor som punkten ser ut, oavsett zoom. Med meter fångade en dörr tryck
 * som gällde grannen så fort man var inzoomad.
 */
function narmasteDorr(punkt, maxPixlar) {
  let bast = null;
  let bastAvstand = maxPixlar;
  synligaAdresser().forEach((a) => {
    const p = motor.pixel(a.lon, a.lat);
    if (!p) return;
    const d = Math.hypot(p.x - punkt.x, p.y - punkt.y);
    if (d <= bastAvstand) { bast = a; bastAvstand = d; }
  });
  return bast;
}

/** Skapar (eller återanvänder) dörren på den tryckta punkten och öppnar den. */
async function oppnaNyDorr(traff, latlng) {
  try {
    const svar = await anrop('adress-ny', {
      gata: traff.gata,
      nummer: traff.nummer,
      postnummer: traff.postnummer || undefined,
      postort: traff.postort,
      omrade_id: S.valtOmrade || undefined,
      lat: latlng.lat,
      lon: latlng.lng,
    });
    if (popp) popp.stang();
    dataAndrad();
    oppnaDorr(svar.adress.id);
  } catch (e) {
    toast('Kunde inte lägga till dörren: ' + e.message);
  }
}

let popp = null;

/**
 * Trycker säljaren på ett hus ska dörren öppnas — finns den redan används
 * den, annars slås adressen upp på kartan så att ingen behöver skriva in den.
 */
async function vidKartklick(ev) {
  const latlng = ev.lngLat;

  // Träffar trycket en utritad dörr är det den som avses.
  if (ev.dorrId) { oppnaDorr(ev.dorrId); return; }

  // 16 bildpunkter ≈ punktens egen storlek. Utanför den räknas trycket
  // som en ny plats, inte som grannens dörr.
  const nara = narmasteDorr(ev.punkt, 16);
  if (nara) { oppnaDorr(nara.id); return; }

  const ruta = document.createElement('div');
  ruta.className = 'kartpopp';
  ruta.textContent = 'Hämtar adressen…';
  if (popp) popp.stang();
  const denna = motor.popup(latlng.lng, latlng.lat, ruta, {
    vidStang: () => { if (popp === denna) popp = null; },
  });
  popp = denna;

  // Husnumren vi redan hämtat kostar ingenting och finns direkt. De frågas
  // först; adresstjänsten är komplementet, inte tvärtom.
  const narmast = husNara(latlng.lat, latlng.lng);

  let traff = null;
  try {
    traff = await adressVid(latlng.lat, latlng.lng);
  } catch (e) { /* uppslaget kan misslyckas — då får man skriva själv */ }
  if (popp !== denna) return;              // rutan stängdes, eller ett nytt tryck kom

  // Förslagen, i tur och ordning: husnumret vi står på, grannarna vi redan
  // ritat ut, och adresstjänstens svar. Dubbletter räknas bara en gång.
  const forslag = [];
  const sedda = new Set();
  const lagg = (a, avstand) => {
    if (!a || !a.gata || !a.nummer) return;
    const nyckel = (a.gata + ' ' + a.nummer).toLowerCase();
    if (sedda.has(nyckel)) return;
    sedda.add(nyckel);
    forslag.push({ ...a, avstand });
  };

  if (narmast[0] && narmast[0].avstand <= 12) lagg(narmast[0], narmast[0].avstand);
  lagg(traff, null);
  narmast.forEach((h) => lagg(h, h.avstand));

  const skrivSjalv = (text, forval) => {
    const knapp = document.createElement('button');
    knapp.className = 'kartpopp-knapp ghost';
    knapp.textContent = text;
    knapp.onclick = () => {
      if (popp) popp.stang();
      manuellDorr(S.omraden, S.valtOmrade, {
        gata: (forval && forval.gata) || '',
        nummer: (forval && forval.nummer) || '',
        postnummer: (forval && forval.postnummer) || '',
        postort: (forval && forval.postort) || '',
        lat: latlng.lat, lon: latlng.lng,
      });
    };
    return knapp;
  };

  ruta.textContent = '';

  if (forslag.length) {
    const basta = forslag[0];
    const rubrik = document.createElement('b');
    rubrik.textContent = basta.gata + ' ' + basta.nummer;
    const ort = document.createElement('div');
    ort.className = 'kartpopp-ort';
    ort.textContent = [visaPostnummer(basta.postnummer), basta.postort].filter(Boolean).join(' ');

    const oppna = document.createElement('button');
    oppna.className = 'kartpopp-knapp';
    oppna.textContent = 'Öppna dörren';
    // Husets egen punkt är bättre än den man råkade träffa med tummen.
    oppna.onclick = () => oppnaNyDorr(basta, basta.lat && basta.lon
      ? { lat: basta.lat, lng: basta.lon } : latlng);
    ruta.append(rubrik, ort, oppna);

    // Står man mellan två hus ska man kunna peka ut vilket, inte gissa.
    const ovriga = forslag.slice(1, 5);
    if (ovriga.length) {
      const rubrik2 = document.createElement('div');
      rubrik2.className = 'kartpopp-ort';
      rubrik2.textContent = 'Eller en granne:';
      ruta.append(rubrik2);
      ovriga.forEach((a) => {
        const k = document.createElement('button');
        k.className = 'kartpopp-knapp ghost';
        k.textContent = a.gata + ' ' + a.nummer +
          (a.avstand ? ' · ' + Math.round(a.avstand) + ' m' : '');
        k.onclick = () => oppnaNyDorr(a, a.lat && a.lon ? { lat: a.lat, lng: a.lon } : latlng);
        ruta.append(k);
      });
    }
    ruta.append(skrivSjalv('Ändra adressen', basta));
    denna.uppdatera();
    return;
  }

  // Ingen adress med husnummer. Gatan vet vi ofta ändå — då är det bara
  // numret som saknas, och det säger vi rakt ut i stället för att hitta på ett.
  const gatan = (traff && traff.gata) || (narmast[0] && narmast[0].gata) || '';
  const text = document.createElement('div');
  text.textContent = gatan
    ? 'Hittade ' + gatan + ', men inget husnummer i kartdatan här. Fyll i numret själv.'
    : 'Ingen adress i kartdatan här. Skriv in den själv.';
  ruta.append(text, skrivSjalv(gatan ? 'Fyll i husnumret' : 'Skriv in adressen', {
    gata: gatan,
    nummer: '',
    postnummer: (traff && traff.postnummer) || '',
    postort: (traff && traff.postort) || '',
  }));
  denna.uppdatera();
}

/** "72134" visas som "721 34". */
function visaPostnummer(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 5 ? d.slice(0, 3) + ' ' + d.slice(3) : '';
}

let saknarKoordinat = 0;
let harDorrar = 0;

/**
 * Förklarar varför kartan ser tom ut. Två skäl kan gälla samtidigt:
 * inklistrade adresser utan koordinater, och kartbild som inte gick att hämta.
 */
function uppdateraBanner() {
  const banner = $('kartBanner');
  if (!banner) return;   // banderollen är borttagen från kartvyn
  const rader = [];
  if (saknarKoordinat) {
    rader.push(harDorrar
      ? saknarKoordinat + ' av dörrarna saknar koordinater och syns inte här. ' +
        'Hämta dem under Admin → Områden, eller använd listan under Dörrar.'
      : 'Ingen av de ' + saknarKoordinat + ' dörrarna har koordinater, så kartan är tom. ' +
        'Hämta koordinater under Admin → Områden — eller jobba i listan under Dörrar så länge.');
  }
  if (kartrutorFel) {
    rader.push('Kartbilden kunde inte hämtas just nu (dålig täckning eller blockerat nät). ' +
      'Dörrpunkterna fungerar ändå.');
  }
  banner.hidden = rader.length === 0;
  banner.innerHTML = rader.map(esc).join('<br>');
}

/** Ritar om alla dörrpunkter utifrån aktuellt urval. */
export function rita() {
  if (!motor || !laddad) return;

  const nu = Date.now();
  const synliga = synligaAdresser();

  motor.dorrar(synliga.map((a) => ({
    id: a.id,
    lon: a.lon,
    lat: a.lat,
    status: a.status || 'ejbesokt',
    sparrad: a.sparrad_till > nu && a.status !== 'ejbesokt',
  })));

  const utanKoordinat = S.adresser.filter((a) =>
    (!S.valtOmrade || a.omrade_id === S.valtOmrade) && (!a.lat || !a.lon)).length;
  $('vySub').textContent =
    synliga.length + ' dörrar på kartan' +
    (utanKoordinat ? ' · ' + utanKoordinat + ' saknar koordinat' : '');

  saknarKoordinat = utanKoordinat;
  harDorrar = synliga.length;
  uppdateraBanner();

  // Zooma till dörrarna första gången, och varje gång området byts —
  // annars blev man kvar på förra områdets vy.
  const urval = S.valtOmrade || 'alla';
  if (synliga.length && centreratOmrade !== urval) {
    motor.passaIn(synliga.map((a) => [a.lon, a.lat]), { kant: 50, maxZoom: 17 });
    centreratOmrade = urval;
    harCentrerat = true;
  }

  ritaNummer();
}

/** Kartan behöver ritas om när dess behållare blir synlig. */
/* ══ Adressökning ══ */

/*
 * "Björkvägen 17" → kartan flyger dit. Vårt eget register frågas först: det
 * är gratis, svarar direkt och innehåller de dörrar laget faktiskt jobbar
 * med. Först när det inte räcker frågas kartans adresstjänst, och då efter
 * en paus så att varje bokstav inte blir ett anrop.
 */
const SOK_PAUS = 450;
let sokTimer = null;
let sokKord = '';
let sokTraffar = [];         // senaste svaret, så samma sökning kan visas igen

export function kopplaSok() {
  const falt = $('adressSok');
  const lada = $('adressTraffar');
  if (!falt || !lada) return;

  falt.addEventListener('input', () => {
    clearTimeout(sokTimer);
    const fraga = falt.value.trim();
    if (fraga.length < 2) { visaTraffar([]); return; }
    sokTimer = setTimeout(() => sok(fraga), SOK_PAUS);
  });
  falt.addEventListener('search', () => { if (!falt.value.trim()) visaTraffar([]); });
  // Tryck utanför stänger listan, annars ligger den kvar över kartan.
  document.addEventListener('click', (ev) => {
    if (!lada.hidden && !ev.target.closest('.adressok')) visaTraffar([]);
  });
}

async function sok(fraga) {
  // Samma sökning igen ska visa listan igen — inte tiga. Söker någon på
  // samma hus två gånger i rad är det för att han vill dit en gång till.
  if (fraga === sokKord) { visaTraffar(sokTraffar); return; }
  sokKord = fraga;
  sokTraffar = [];

  let egna = [];
  try {
    egna = ((await anrop('adress-sok', { fraga })).traffar || [])
      .map((a) => ({ ...a, vår: true }));
  } catch (e) {
    // Utan täckning söker vi bland dörrarna telefonen redan har. Annars går
    // det inte att öppna en dörr alls när nätet är borta, och registrering
    // offline är hela poängen med kön.
    egna = lokalSok(fraga);
  }
  if (fraga !== sokKord) return;               // en nyare sökning hann före

  sokTraffar = egna;
  visaTraffar(egna, egna.length ? '' : 'Söker på kartan…');

  // Har vi själva adressen behöver ingen extern tjänst frågas alls.
  if (egna.some((a) => a.nummer)) return;

  let franKartan = [];
  try {
    franKartan = await sokAdress(fraga);
  } catch (e) { /* ingen träff är ett giltigt svar */ }
  if (fraga !== sokKord) return;

  const nyckel = (a) => (a.gata + ' ' + a.nummer).toLowerCase();
  const sedda = new Set(egna.map(nyckel));
  sokTraffar = egna.concat(franKartan.filter((a) => !sedda.has(nyckel(a))));
  visaTraffar(sokTraffar);
}

/** Samma sökning, men mot dörrarna som redan ligger i telefonen. */
function lokalSok(fraga) {
  const ord = fraga.toLowerCase().trim();
  return (S.adresser || [])
    .filter((a) => ((a.gata || '') + ' ' + (a.nummer || '')).toLowerCase().includes(ord) ||
      (a.full_adress || '').toLowerCase().includes(ord))
    .slice(0, 25)
    .map((a) => ({ ...a, vår: true }));
}

function visaTraffar(traffar, vantar) {
  const lada = $('adressTraffar');
  if (!lada) return;

  if (!traffar.length && !vantar) { lada.hidden = true; lada.innerHTML = ''; return; }
  lada.hidden = false;

  lada.innerHTML = traffar.map((a, i) =>
    '<button class="adressok-traff" data-i="' + i + '">' +
    '<b>' + esc([a.gata, a.nummer].filter(Boolean).join(' ')) + '</b>' +
    '<span>' + esc([visaPostnummer(a.postnummer), a.postort].filter(Boolean).join(' ') ||
      (a.etikett || '').split(',').slice(1, 3).join(',').trim()) +
    (a.vår ? ' · i registret' : '') + '</span></button>').join('') +
    (vantar ? '<div class="adressok-vantar">' + esc(vantar) + '</div>' : '');

  lada.querySelectorAll('[data-i]').forEach((k) => {
    k.onclick = () => valjTraff(traffar[+k.dataset.i]);
  });
}

/** En träff i listan: flyg dit, och öppna dörren om det är en av våra. */
function valjTraff(a) {
  visaTraffar([]);
  $('adressSok').value = [a.gata, a.nummer].filter(Boolean).join(' ');
  $('adressSok').blur();
  if (motor && a.lat && a.lon) motor.flyg(a.lon, a.lat, 18);

  if (a.vår) { oppnaDorr(a.id); return; }
  // En adress från kartan är ingen dörr än — säljaren får välja att lägga
  // upp den, i stället för att ett sökresultat tyst skapar en dörr.
  if (!motor || !a.nummer) return;
  let popp2 = null;
  const ruta = document.createElement('div');
  ruta.className = 'kartpopp';
  const rubrik = document.createElement('b');
  rubrik.textContent = a.gata + ' ' + a.nummer;
  const ort = document.createElement('div');
  ort.className = 'kartpopp-ort';
  ort.textContent = [visaPostnummer(a.postnummer), a.postort].filter(Boolean).join(' ');
  const knapp = document.createElement('button');
  knapp.className = 'kartpopp-knapp';
  knapp.textContent = 'Öppna dörren';
  knapp.onclick = () => { popp2.stang(); oppnaNyDorr(a, { lat: a.lat, lng: a.lon }); };
  ruta.append(rubrik, ort, knapp);
  popp2 = motor.popup(a.lon, a.lat, ruta);
}

export async function visa() {
  await skapa();
  if (!motor) return;
  // Två omräkningar: en direkt och en när layouten hunnit sätta sig.
  motor.omrakna();
  setTimeout(() => { if (motor) motor.omrakna(); }, 200);
  rita();
  if (arRoll('teamleader')) ritaSaljare();
}

// Rotation och storleksändring gör annars kartan grå tills man rör den.
let omraknare = null;
['resize', 'orientationchange'].forEach((h) => {
  window.addEventListener(h, () => {
    if (!motor) return;
    clearTimeout(omraknare);
    omraknare = setTimeout(() => { if (motor) motor.omrakna(); }, 150);
  });
});

/**
 * Tappad GPS-signal: punkten står kvar där vi sist såg dig, men gråas så
 * att det syns att den inte är färsk.
 */
export function gammalPosition() {
  positionGammal = true;
  if (jagMarkor) jagMarkor.el.classList.add('gammal');
}

export function centreraPa(adress) {
  if (!motor || !adress.lat) return;
  motor.flyg(adress.lon, adress.lat, 18);
}

export function egenPosition(lat, lon) {
  senastePosition = { lat, lon };
  positionGammal = false;
  ritaPosition();
}

/** Ritar ut den senaste positionen — direkt, eller när kartan blivit klar. */
function ritaPosition() {
  if (!motor || !laddad || !senastePosition) return;
  const { lat, lon } = senastePosition;
  if (!jagMarkor) {
    const prick = document.createElement('div');
    prick.className = 'jag-punkt';
    jagMarkor = motor.markor(prick, lon, lat);
  } else {
    jagMarkor.flytta(lon, lat);
  }
  jagMarkor.el.classList.toggle('gammal', positionGammal);
  // Dörrarna har företräde; hoppa hit bara när det inte finns några att visa.
  if (!harCentrerat && !harDorrar) {
    motor.flyg(lon, lat, 17);
    harCentrerat = true;
  }
}

async function ritaSaljare() {
  try {
    const data = await anrop('positioner');
    if (!motor) return;
    saljarMarkorer.forEach((m) => m.bort());
    saljarMarkorer = [];
    (data.positioner || []).forEach((p) => {
      if (p.anvandare_id === S.anvandare.id || !p.lat) return;
      const etikett = document.createElement('div');
      etikett.className = 'saljar-etikett';
      etikett.textContent = p.namn;
      etikett.title = 'Senast sedd ' + visaTidpunkt(p.uppdaterad);
      saljarMarkorer.push(motor.markor(etikett, p.lon, p.lat));
    });
  } catch (e) { /* positioner är en bonus, inte kritiskt */ }
}

/** Föreslår och öppnar nästa lämpliga dörr. */
export async function nastaDorr() {
  try {
    const data = await anrop('nasta-dorr', {
      omrade_id: S.valtOmrade || undefined,
      lat: S.position ? S.position.lat : undefined,
      lon: S.position ? S.position.lon : undefined,
    });
    if (!data.adress) {
      toast('Inga obesökta dörrar kvar i området');
      return;
    }
    centreraPa(data.adress);
    oppnaDorr(data.adress.id);
  } catch (e) {
    toast('Kunde inte hämta nästa dörr: ' + e.message);
  }
}
