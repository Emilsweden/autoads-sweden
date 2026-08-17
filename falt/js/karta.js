/** Kartvyn — alla dörrar i området som färgade punkter, plus säljarnas position. */

import { anrop } from './api.js';
import { $, esc, toast, STATUS_TEXT, STATUS_FARG, visaTidpunkt } from './ui.js';
import { S, arRoll } from './state.js';
import { oppna as oppnaDorr } from './dorr.js';

let karta = null;
let dorrLager = null;
let saljarLager = null;
let jagMarkor = null;
let harCentrerat = false;

const VASTERAS = [59.6099, 16.5448];

function skapa() {
  if (karta) return;
  if (typeof L === 'undefined') {
    // Kartbiblioteket kunde inte hämtas (t.ex. helt utan täckning).
    // Resten av appen ska fungera ändå — dörrarna finns i listvyn.
    $('karta').innerHTML =
      '<div class="tom">Kartan kunde inte laddas.<br>Dörrarna finns kvar under <b>Dörrar</b>.</div>';
    return;
  }
  karta = L.map('karta', { zoomControl: true, attributionControl: true }).setView(VASTERAS, 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(karta);
  dorrLager = L.layerGroup().addTo(karta);
  saljarLager = L.layerGroup().addTo(karta);

  $('teckenforklaring').innerHTML = [
    ['ejbesokt', 'Ej besökt'], ['bokat', 'Bokad'], ['ejsvar', 'Inget svar'],
    ['aterkom', 'Återkom'], ['nej', 'Nej'], ['sparrad', 'Nyligen besökt'],
  ].map(([k, t]) => '<span><i style="background:' + STATUS_FARG[k] + '"></i>' + t + '</span>').join('');
}

/** Ritar om alla dörrpunkter utifrån aktuellt urval. */
export function rita() {
  if (!karta) return;
  dorrLager.clearLayers();

  const nu = Date.now();
  const synliga = S.adresser.filter((a) =>
    (!S.valtOmrade || a.omrade_id === S.valtOmrade) && a.lat && a.lon);

  synliga.forEach((a) => {
    const sparrad = a.sparrad_till > nu && a.status !== 'ejbesokt';
    const markor = L.circleMarker([a.lat, a.lon], {
      radius: 8,
      color: sparrad ? STATUS_FARG.sparrad : '#0d0d0d',
      weight: sparrad ? 3 : 1.5,
      fillColor: STATUS_FARG[a.status] || STATUS_FARG.ejbesokt,
      fillOpacity: 0.95,
    });
    markor.bindTooltip(a.adress, { direction: 'top' });
    markor.on('click', () => oppnaDorr(a.id));
    markor.addTo(dorrLager);
  });

  const utanKoordinat = S.adresser.filter((a) =>
    (!S.valtOmrade || a.omrade_id === S.valtOmrade) && (!a.lat || !a.lon)).length;
  $('vySub').textContent =
    synliga.length + ' dörrar på kartan' +
    (utanKoordinat ? ' · ' + utanKoordinat + ' saknar koordinat' : '');

  if (!harCentrerat && synliga.length) {
    karta.fitBounds(L.latLngBounds(synliga.map((a) => [a.lat, a.lon])), { padding: [40, 40], maxZoom: 17 });
    harCentrerat = true;
  }
}

/** Kartan behöver ritas om när dess behållare blir synlig. */
export function visa() {
  skapa();
  if (!karta) return;
  setTimeout(() => karta.invalidateSize(), 60);
  rita();
  if (arRoll('teamleader')) ritaSaljare();
}

export function centreraPa(adress) {
  if (!karta || !adress.lat) return;
  karta.setView([adress.lat, adress.lon], 18);
}

export function egenPosition(lat, lon) {
  if (!karta) return;
  if (!jagMarkor) {
    jagMarkor = L.circleMarker([lat, lon], {
      radius: 7, color: '#fff', weight: 2, fillColor: '#c9a84c', fillOpacity: 1,
    }).addTo(karta).bindTooltip('Du');
  } else {
    jagMarkor.setLatLng([lat, lon]);
  }
  if (!harCentrerat) { karta.setView([lat, lon], 17); harCentrerat = true; }
}

async function ritaSaljare() {
  try {
    const data = await anrop('positioner');
    saljarLager.clearLayers();
    (data.positioner || []).forEach((p) => {
      if (p.anvandare_id === S.anvandare.id || !p.lat) return;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="background:#c9a84c;color:#0d0d0d;font-size:10px;font-weight:700;' +
            'padding:3px 7px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6)">' +
            esc(p.namn) + '</div>',
          iconAnchor: [20, 10],
        }),
      }).addTo(saljarLager).bindTooltip('Senast sedd ' + visaTidpunkt(p.uppdaterad));
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

export function statusText(a) {
  return STATUS_TEXT[a.status] || a.status;
}
