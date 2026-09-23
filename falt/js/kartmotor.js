/**
 * Kartmotorn — det enda i appen som vet vilken karta som ritar.
 *
 * Googles karta används när en nyckel finns och den hinner laddas. Annars —
 * ingen nyckel, inget nät, fel nyckel, eller kvoten slut — tar
 * OpenStreetMap-kartan (MapLibre) över, med allt i behåll. Den ligger i
 * appen själv och fungerar utan täckning.
 *
 * Båda motorerna ger samma lilla gränssnitt, så karta.js behöver inte veta
 * vilken som är igång. Koordinater skickas alltid som (lon, lat).
 */

import { STATUS_FARG } from './ui.js';
import { GOOGLE_MAPS_NYCKEL, GOOGLE_MAPS_KARTID } from '../config.js';

/**
 * Väljer och startar en motor. `vidFel` anropas om Googles karta slutar
 * fungera efter att den startat — kvoten tar slut, nyckeln spärras — så att
 * karta.js kan byta till OpenStreetMap-kartan mitt i passet. `baraReserv`
 * används vid det bytet: Google ska inte provas igen samma pass.
 */
export async function valjMotor(behallare, start, { vidFel, baraReserv = false } = {}) {
  if (!baraReserv && GOOGLE_MAPS_NYCKEL && GOOGLE_MAPS_KARTID) {
    try {
      const { skapaGoogle } = await import('./kartmotor-google.js');
      return await skapaGoogle(behallare, start, {
        nyckel: GOOGLE_MAPS_NYCKEL, kartid: GOOGLE_MAPS_KARTID, vidFel,
      });
    } catch (e) {
      // Googles karta gick inte att starta. Det är ett väntat läge — utan
      // täckning, eller när dagens kvot är slut — inte ett fel för säljaren.
      console.warn('Googles karta används inte: ' + (e && e.message));
      rensa(behallare);
    }
  }
  return skapaMapLibre(behallare, start);
}

/** Tar bort allt en motor lämnat efter sig i behållaren. */
export function rensa(behallare) {
  behallare.innerHTML = '';
  behallare.removeAttribute('style');
  behallare.className = '';
}

/** Punktens radie i bildpunkter vid en viss zoom — större inzoomat. */
export const RADIE = [[12, 3], [15, 5], [18, 7], [20, 9]];

const STATUSAR = ['bokat', 'ejsvar', 'nej', 'aterkom', 'ejbesokt'];

/** Färg per status, som ett uttryck MapLibre kan räkna på i renderingen. */
function fargUttryck(tabell, standard) {
  const ut = ['match', ['get', 'status']];
  STATUSAR.forEach((s) => ut.push(s, tabell[s]));
  ut.push(standard);
  return ut;
}

const DORRAR = 'dorrar';
const KARTDATA = 'openmaptiles';   // källan i kartstilen som bär gator och hus

/*
 * Upphovsrätten för kartan. Den sätts på kontrollen och inte på källan i
 * stilen: MapLibre visar en källas text först när källan laddats, och utan
 * täckning blev rutan då tom.
 */
const KARTRATT =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
  'Data från <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/* ══ OpenStreetMap-kartan (MapLibre) ══ */

/**
 * Renderas med MapLibre (WebGL): vridning med två fingrar, lutning, steglös
 * zoom och hus i 3D när man lutar kartan. Kartbilden är OpenStreetMaps data
 * i OpenFreeMaps stil Liberty — gratis, utan konto och utan nyckel.
 *
 * Stilen ligger i appen (falt/kartstil/liberty.json), inte hos OpenFreeMap.
 * Då startar kartan även utan täckning: kartbilden blir tom, men dörrarna
 * syns och går att trycka på. Returnerar null om biblioteket inte finns
 * (helt utan täckning första gången appen öppnas).
 */
function skapaMapLibre(behallare, start) {
  if (typeof maplibregl === 'undefined') return null;

  const karta = new maplibregl.Map({
    container: behallare,
    center: [start.lon, start.lat],
    zoom: start.zoom,
    maxZoom: 21,          // kartdatan slutar på 14, resten ritas upp skarpt ur den
    maxPitch: 70,
    attributionControl: { compact: true, customAttribution: KARTRATT },
    style: new URL('kartstil/liberty.json', location.href).href,
  });

  // Vridning och lutning med två fingrar, och en kompass som ställer tillbaka.
  karta.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left');
  karta.touchZoomRotate.enableRotation();

  let klar = false;
  const vantar = [];
  const lyssnare = { klick: [], vila: [], rorelseslut: [] };
  const skicka = (namn, ...a) => lyssnare[namn].forEach((fn) => fn(...a));

  karta.on('load', () => {
    karta.addSource(DORRAR, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const radie = ['interpolate', ['linear'], ['zoom']];
    RADIE.forEach(([z, r]) => radie.push(z, r));
    karta.addLayer({
      id: DORRAR,
      type: 'circle',
      source: DORRAR,
      paint: {
        'circle-radius': radie,
        'circle-color': fargUttryck(STATUS_FARG, STATUS_FARG.ejbesokt),
        'circle-opacity': 1,
        'circle-stroke-width': ['case', ['get', 'sparrad'], 2, 1],
        'circle-stroke-color': ['case', ['get', 'sparrad'], STATUS_FARG.sparrad, '#0d0d0d'],
      },
    });
    karta.on('click', (ev) => {
      const traff = karta.queryRenderedFeatures(ev.point, { layers: [DORRAR] });
      skicka('klick', {
        lngLat: { lat: ev.lngLat.lat, lng: ev.lngLat.lng },
        punkt: { x: ev.point.x, y: ev.point.y },
        dorrId: traff.length ? traff[0].properties.id : null,
      });
    });
    karta.on('moveend', () => skicka('rorelseslut'));
    karta.on('zoomend', () => skicka('rorelseslut'));
    // 'idle' är det enda som säkert kommer efter allt kartan gör — även
    // efter en storleksändring, som inte ger moveend.
    karta.on('idle', () => skicka('vila'));
    karta.on('mouseenter', DORRAR, () => { karta.getCanvas().style.cursor = 'pointer'; });
    karta.on('mouseleave', DORRAR, () => { karta.getCanvas().style.cursor = ''; });
    klar = true;
    vantar.splice(0).forEach((fn) => fn());
  });

  return {
    namn: 'maplibre',
    karta,
    arKlar: () => klar,
    klar(fn) { if (klar) fn(); else vantar.push(fn); },
    nar(handelse, fn) { lyssnare[handelse].push(fn); },
    zoom: () => karta.getZoom(),
    grans: () => karta.getBounds(),
    pixel(lon, lat) { const p = karta.project([lon, lat]); return { x: p.x, y: p.y }; },
    flyg(lon, lat, zoom) { karta.easeTo({ center: [lon, lat], zoom }); },
    hoppa(lon, lat, zoom) { karta.jumpTo({ center: [lon, lat], zoom }); },
    passaIn(punkter, { kant, maxZoom }) {
      const grans = new maplibregl.LngLatBounds();
      punkter.forEach((p) => grans.extend(p));
      karta.fitBounds(grans, { padding: kant, maxZoom, duration: 0 });
    },
    dorrar(lista) {
      const kalla = karta.getSource(DORRAR);
      if (!kalla) return;
      kalla.setData({
        type: 'FeatureCollection',
        features: lista.map((d) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
          properties: { id: d.id, status: d.status, sparrad: d.sparrad },
        })),
      });
    },
    markor(el, lon, lat, { klick } = {}) {
      if (klick) el.addEventListener('click', (ev) => { ev.stopPropagation(); klick(); });
      const m = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(karta);
      return { el, flytta: (lo, la) => m.setLngLat([lo, la]), bort: () => m.remove() };
    },
    popup(lon, lat, innehall, { vidStang } = {}) {
      const p = new maplibregl.Popup({ offset: 12, closeButton: true })
        .setLngLat([lon, lat]).setDOMContent(innehall).addTo(karta);
      if (vidStang) p.on('close', vidStang);
      // MapLibre följer med när innehållet ändras; uppdatera behövs inte.
      return { stang: () => p.remove(), uppdatera() {} };
    },
    knapp(el) {
      const ruta = document.createElement('div');
      ruta.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      ruta.appendChild(el);
      karta.addControl({ onAdd: () => ruta, onRemove() { /* kartan städar själv */ } }, 'top-left');
    },
    omrakna: () => karta.resize(),
    // Utan kartbild ser kartan bara tom ut. Punkterna fungerar ändå — de
    // ligger i ett eget lager — så det är värt att säga vad som hänt.
    vidKartbildFel(fn) {
      let fel = false;
      karta.on('error', (e) => {
        if (!e || e.sourceId !== KARTDATA || fel) return;
        fel = true; fn(true);
      });
      karta.on('data', (e) => {
        if (!fel || !e || e.sourceId !== KARTDATA || !e.isSourceLoaded) return;
        fel = false; fn(false);
      });
    },
    forstor() { karta.remove(); rensa(behallare); },
  };
}
