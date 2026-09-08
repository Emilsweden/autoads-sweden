/**
 * Kartvyn — alla dörrar i området som färgade punkter, plus säljarnas position.
 *
 * Renderas med MapLibre (WebGL) i stället för vanliga kartrutor: det ger
 * vridning med två fingrar, lutning och steglös zoom, vilket efterfrågades
 * ute i fält. Kartbilden är fortfarande OpenStreetMap.
 */

import { anrop } from './api.js';
import { $, esc, toast, STATUS_FARG, STATUS_TEXTFARG, visaTidpunkt } from './ui.js';
import { S, arRoll, dataAndrad } from './state.js';
import { oppna as oppnaDorr, manuell as manuellDorr } from './dorr.js';
import { adressVid } from './geo.js';

let karta = null;
let jagMarkor = null;
let saljarMarkorer = [];
let harCentrerat = false;
let centreratOmrade = null;   // vilket urval kartan senast zoomade till
let kartrutorFel = false;     // kartbilden kunde inte hämtas (nät/brandvägg)
let laddad = false;

const VASTERAS = [16.5448, 59.6099];   // MapLibre vill ha [lon, lat]
const DORRAR = 'dorrar';
const NUMMER = 'dorrnummer';

const STATUSAR = ['bokat', 'ejsvar', 'nej', 'aterkom', 'ejbesokt'];

/** Färg per status, som ett uttryck MapLibre kan räkna på i renderingen. */
function fargUttryck(tabell, standard) {
  const ut = ['match', ['get', 'status']];
  STATUSAR.forEach((s) => ut.push(s, tabell[s]));
  ut.push(standard);
  return ut;
}

/** Knapp som hoppar till säljarens egen position. */
function positionsKnapp() {
  return {
    onAdd() {
      const ruta = document.createElement('div');
      ruta.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const knapp = document.createElement('button');
      knapp.type = 'button';
      knapp.className = 'kartknapp-jag';
      knapp.title = 'Min position';
      knapp.setAttribute('aria-label', 'Min position');
      knapp.textContent = '◎';
      knapp.onclick = () => {
        if (!S.position) { toast('Ingen position ännu — tillåt platsdelning'); return; }
        karta.easeTo({ center: [S.position.lon, S.position.lat], zoom: Math.max(karta.getZoom(), 17) });
      };
      ruta.appendChild(knapp);
      return ruta;
    },
    onRemove() { /* kartan städar upp själv */ },
  };
}

function skapa() {
  if (karta) return;
  if (typeof maplibregl === 'undefined') {
    // Kartbiblioteket kunde inte hämtas (t.ex. helt utan täckning).
    // Resten av appen ska fungera ändå — dörrarna finns i listvyn.
    $('karta').innerHTML =
      '<div class="tom">Kartan kunde inte laddas.<br>Dörrarna finns kvar under <b>Dörrar</b>.</div>';
    return;
  }

  karta = new maplibregl.Map({
    container: 'karta',
    center: VASTERAS,
    zoom: 13,
    maxZoom: 21,          // kartrutorna slutar på 19, resten är förstoring
    maxPitch: 70,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; OpenStreetMap',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  });

  // Kartan exponeras för felsökning och för de automatiska proven.
  window.__karta = karta;

  // Vridning och lutning med två fingrar, och en kompass som ställer tillbaka.
  karta.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left');
  karta.addControl(positionsKnapp(), 'top-left');
  karta.touchZoomRotate.enableRotation();

  karta.on('load', () => {
    laddad = true;
    karta.addSource(DORRAR, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Husnumret är det man känner igen huset på ute på gatan, så markören
    // är numret självt — en färgad bricka i husets status.
    karta.addLayer({
      id: DORRAR,
      type: 'circle',
      source: DORRAR,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 15, 19, 21],
        'circle-color': fargUttryck(STATUS_FARG, STATUS_FARG.ejbesokt),
        'circle-opacity': 1,
        'circle-stroke-width': ['case', ['get', 'sparrad'], 3, 1.6],
        'circle-stroke-color': ['case', ['get', 'sparrad'], STATUS_FARG.sparrad, '#0d0d0d'],
      },
    });
    karta.on('click', vidKartklick);
    karta.on('moveend', ritaNummer);
    karta.on('zoomend', ritaNummer);
    karta.on('mouseenter', DORRAR, () => { karta.getCanvas().style.cursor = 'pointer'; });
    karta.on('mouseleave', DORRAR, () => { karta.getCanvas().style.cursor = ''; });
    rita();
  });

  // Utan kartbild ser kartan bara tom ut. Säg vad som hänt i stället —
  // punkterna fungerar ändå, de ligger i ett eget lager.
  karta.on('error', (e) => {
    if (!e || !e.sourceId || e.sourceId !== 'osm' || kartrutorFel) return;
    kartrutorFel = true;
    uppdateraBanner();
  });
  karta.on('data', (e) => {
    if (!kartrutorFel || !e || e.sourceId !== 'osm' || !e.isSourceLoaded) return;
    kartrutorFel = false;
    uppdateraBanner();
  });

  $('teckenforklaring').innerHTML = [
    ['ejbesokt', 'Ej besökt'], ['bokat', 'Bokad'], ['ejsvar', 'Inget svar'],
    ['aterkom', 'Återkom'], ['nej', 'Nej'], ['sparrad', 'Nyligen besökt'],
  ].map(([k, t]) => '<span><i style="background:' + STATUS_FARG[k] + '"></i>' + t + '</span>').join('');
}

/* ── Husnummer som brickor ── */

const NUMMER_ZOOM = 15.5;   // längre ut blir numren oläsliga och kartan full
const MAX_NUMMER = 400;     // så många brickor räcker för ett kvarter

const brickor = new Map();  // adress-id → markör

/**
 * Ritar husnumret på varje hus i vyn. Numret är det man känner igen huset
 * på ute på gatan, så det är markören — inte en generisk kartnål.
 * Längre ut visas i stället färgade punkter, annars blir kartan full.
 */
function ritaNummer() {
  if (!karta || !laddad) return;
  const visaNummer = karta.getZoom() >= NUMMER_ZOOM;

  if (karta.getLayer(DORRAR)) {
    karta.setLayoutProperty(DORRAR, 'visibility', visaNummer ? 'none' : 'visible');
  }
  if (!visaNummer) {
    brickor.forEach((m) => m.remove());
    brickor.clear();
    return;
  }

  // Lite marginal runt vyn, så att brickorna finns på plats innan huset
  // kommer in i bild i stället för att poppa upp vid kanten.
  const g = karta.getBounds();
  const dLat = (g.getNorth() - g.getSouth()) * 0.3;
  const dLon = (g.getEast() - g.getWest()) * 0.3;
  const inom = (a) => a.lat > g.getSouth() - dLat && a.lat < g.getNorth() + dLat
    && a.lon > g.getWest() - dLon && a.lon < g.getEast() + dLon;

  const nu = Date.now();
  const kvar = new Set();

  synligaAdresser()
    .filter(inom)
    .slice(0, MAX_NUMMER)
    .forEach((a) => {
      kvar.add(a.id);
      const sparrad = a.sparrad_till > nu && a.status !== 'ejbesokt';
      const klasser = 'hus-nummer s-' + (a.status || 'ejbesokt') + (sparrad ? ' sparrad' : '');
      const fanns = brickor.get(a.id);
      if (fanns) {
        const el = fanns.getElement();
        if (el.className !== klasser) el.className = klasser;
        if (el.textContent !== (a.nummer || '?')) el.textContent = a.nummer || '?';
        fanns.setLngLat([a.lon, a.lat]);
        return;
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = klasser;
      el.textContent = a.nummer || '?';
      el.title = a.adress;
      el.onclick = (ev) => { ev.stopPropagation(); oppnaDorr(a.id); };
      brickor.set(a.id, new maplibregl.Marker({ element: el }).setLngLat([a.lon, a.lat]).addTo(karta));
    });

  brickor.forEach((m, id) => {
    if (kvar.has(id)) return;
    m.remove();
    brickor.delete(id);
  });
}

/** Adresserna i valt område som har ett läge att rita ut. */
function synligaAdresser() {
  return S.adresser.filter((a) =>
    (!S.valtOmrade || a.omrade_id === S.valtOmrade) && a.lat && a.lon);
}

/* ── Tryck på kartan ── */

/** Meter mellan två punkter, tillräckligt exakt på kvartersavstånd. */
function avstand(a, lat, lon) {
  const dx = (a.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180);
  const dy = (a.lat - lat) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

function narmasteDorr(lat, lon, max) {
  let bast = null;
  let bastAvstand = max;
  S.adresser.forEach((a) => {
    if (!a.lat || !a.lon) return;
    const d = avstand(a, lat, lon);
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
      postort: traff.postort,
      omrade_id: S.valtOmrade || undefined,
      lat: latlng.lat,
      lon: latlng.lng,
    });
    if (popp) popp.remove();
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
  const traffade = karta.queryRenderedFeatures(ev.point, { layers: [DORRAR] });
  if (traffade.length) { oppnaDorr(traffade[0].properties.id); return; }

  const nara = narmasteDorr(latlng.lat, latlng.lng, 25);
  if (nara) { oppnaDorr(nara.id); return; }

  const ruta = document.createElement('div');
  ruta.className = 'kartpopp';
  ruta.textContent = 'Hämtar adressen…';
  if (popp) popp.remove();
  popp = new maplibregl.Popup({ offset: 12, closeButton: true }).setLngLat(latlng).setDOMContent(ruta).addTo(karta);

  let traff = null;
  try {
    traff = await adressVid(latlng.lat, latlng.lng);
  } catch (e) { /* uppslaget kan misslyckas — då får man skriva själv */ }

  const skrivSjalv = (text) => {
    const knapp = document.createElement('button');
    knapp.className = 'kartpopp-knapp ghost';
    knapp.textContent = text;
    knapp.onclick = () => {
      if (popp) popp.remove();
      manuellDorr(S.omraden, S.valtOmrade, {
        gata: (traff && traff.gata) || '',
        nummer: (traff && traff.nummer) || '',
        postort: (traff && traff.postort) || '',
        lat: latlng.lat, lon: latlng.lng,
      });
    };
    return knapp;
  };

  ruta.textContent = '';
  if (traff && traff.gata && traff.nummer) {
    const rubrik = document.createElement('b');
    rubrik.textContent = traff.gata + ' ' + traff.nummer;
    const ort = document.createElement('div');
    ort.className = 'kartpopp-ort';
    ort.textContent = traff.postort || '';
    const oppna = document.createElement('button');
    oppna.className = 'kartpopp-knapp';
    oppna.textContent = 'Öppna dörren';
    oppna.onclick = () => oppnaNyDorr(traff, latlng);
    ruta.append(rubrik, ort, oppna, skrivSjalv('Ändra adressen'));
  } else {
    const text = document.createElement('div');
    text.textContent = traff && traff.gata
      ? 'Hittade ' + traff.gata + ', men inget husnummer på den här punkten.'
      : 'Hittade ingen adress här.';
    ruta.append(text, skrivSjalv('Skriv in adressen'));
  }
}

let saknarKoordinat = 0;
let harDorrar = 0;

/**
 * Förklarar varför kartan ser tom ut. Två skäl kan gälla samtidigt:
 * inklistrade adresser utan koordinater, och kartbild som inte gick att hämta.
 */
function uppdateraBanner() {
  const banner = $('kartBanner');
  if (!banner) return;
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
  if (!karta || !laddad) return;

  const nu = Date.now();
  const synliga = synligaAdresser();

  karta.getSource(DORRAR).setData({
    type: 'FeatureCollection',
    features: synliga.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        nummer: a.nummer || '',
        status: a.status || 'ejbesokt',
        sparrad: a.sparrad_till > nu && a.status !== 'ejbesokt',
      },
    })),
  });

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
    const grans = new maplibregl.LngLatBounds();
    synliga.forEach((a) => grans.extend([a.lon, a.lat]));
    karta.fitBounds(grans, { padding: 50, maxZoom: 17, duration: 0 });
    centreratOmrade = urval;
    harCentrerat = true;
  }

  ritaNummer();
}

/** Kartan behöver ritas om när dess behållare blir synlig. */
export function visa() {
  skapa();
  if (!karta) return;
  // Två omräkningar: en direkt och en när layouten hunnit sätta sig.
  karta.resize();
  setTimeout(() => karta.resize(), 200);
  rita();
  if (arRoll('teamleader')) ritaSaljare();
}

// Rotation och storleksändring gör annars kartan grå tills man rör den.
let omraknare = null;
['resize', 'orientationchange'].forEach((h) => {
  window.addEventListener(h, () => {
    if (!karta) return;
    clearTimeout(omraknare);
    omraknare = setTimeout(() => karta.resize(), 150);
  });
});

/**
 * Tappad GPS-signal: punkten står kvar där vi sist såg dig, men gråas så
 * att det syns att den inte är färsk.
 */
export function gammalPosition() {
  if (jagMarkor) jagMarkor.getElement().classList.add('gammal');
}

export function centreraPa(adress) {
  if (!karta || !adress.lat) return;
  karta.easeTo({ center: [adress.lon, adress.lat], zoom: 18 });
}

export function egenPosition(lat, lon) {
  if (!karta) return;
  if (!jagMarkor) {
    const prick = document.createElement('div');
    prick.className = 'jag-punkt';
    jagMarkor = new maplibregl.Marker({ element: prick }).setLngLat([lon, lat]).addTo(karta);
  } else {
    jagMarkor.getElement().classList.remove('gammal');
    jagMarkor.setLngLat([lon, lat]);
  }
  // Dörrarna har företräde; hoppa hit bara när det inte finns några att visa.
  if (!harCentrerat && !harDorrar) {
    karta.easeTo({ center: [lon, lat], zoom: 17 });
    harCentrerat = true;
  }
}

async function ritaSaljare() {
  try {
    const data = await anrop('positioner');
    saljarMarkorer.forEach((m) => m.remove());
    saljarMarkorer = [];
    (data.positioner || []).forEach((p) => {
      if (p.anvandare_id === S.anvandare.id || !p.lat) return;
      const etikett = document.createElement('div');
      etikett.className = 'saljar-etikett';
      etikett.textContent = p.namn;
      etikett.title = 'Senast sedd ' + visaTidpunkt(p.uppdaterad);
      saljarMarkorer.push(new maplibregl.Marker({ element: etikett }).setLngLat([p.lon, p.lat]).addTo(karta));
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
