/** Kartvyn — alla dörrar i området som färgade punkter, plus säljarnas position. */

import { anrop } from './api.js';
import { $, esc, toast, STATUS_FARG, visaTidpunkt } from './ui.js';
import { S, arRoll } from './state.js';
import { oppna as oppnaDorr } from './dorr.js';

let karta = null;
let dorrLager = null;
let saljarLager = null;
let jagMarkor = null;
let harCentrerat = false;
let centreratOmrade = null;   // vilket urval kartan senast zoomade till
let kartrutorFel = false;     // kartbilden kunde inte hämtas (nät/brandvägg)

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
  const rutor = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(karta);
  // Utan kartbild ser kartan bara grå ut. Säg vad som hänt i stället —
  // punkterna fungerar ändå, de ligger i ett eget lager.
  rutor.on('tileerror', () => {
    if (kartrutorFel) return;
    kartrutorFel = true;
    uppdateraBanner();
  });
  rutor.on('tileload', () => {
    if (!kartrutorFel) return;
    kartrutorFel = false;
    uppdateraBanner();
  });
  dorrLager = L.layerGroup().addTo(karta);
  saljarLager = L.layerGroup().addTo(karta);

  $('teckenforklaring').innerHTML = [
    ['ejbesokt', 'Ej besökt'], ['bokat', 'Bokad'], ['ejsvar', 'Inget svar'],
    ['aterkom', 'Återkom'], ['nej', 'Nej'], ['sparrad', 'Nyligen besökt'],
  ].map(([k, t]) => '<span><i style="background:' + STATUS_FARG[k] + '"></i>' + t + '</span>').join('');
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
  if (!karta) return;
  dorrLager.clearLayers();

  const nu = Date.now();
  const synliga = S.adresser.filter((a) =>
    (!S.valtOmrade || a.omrade_id === S.valtOmrade) && a.lat && a.lon);

  synliga.forEach((a) => {
    const sparrad = a.sparrad_till > nu && a.status !== 'ejbesokt';
    const markor = L.circleMarker([a.lat, a.lon], {
      radius: 8,
      color: sparrad ? STATUS_FARG.sparrad : '#ffffff',
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

  saknarKoordinat = utanKoordinat;
  harDorrar = synliga.length;
  uppdateraBanner();

  // Zooma till dörrarna första gången, och varje gång området byts —
  // annars blev man kvar på förra områdets vy.
  const urval = S.valtOmrade || 'alla';
  if (synliga.length && centreratOmrade !== urval) {
    karta.fitBounds(L.latLngBounds(synliga.map((a) => [a.lat, a.lon])), { padding: [40, 40], maxZoom: 17 });
    centreratOmrade = urval;
    harCentrerat = true;
  }
}

/** Kartan behöver ritas om när dess behållare blir synlig. */
export function visa() {
  skapa();
  if (!karta) return;
  // Två omräkningar: en direkt och en när layouten hunnit sätta sig.
  karta.invalidateSize();
  setTimeout(() => karta.invalidateSize(), 200);
  rita();
  if (arRoll('teamleader')) ritaSaljare();
}

// Rotation och storleksändring gör annars kartan grå tills man rör den.
let omraknare = null;
['resize', 'orientationchange'].forEach((h) => {
  window.addEventListener(h, () => {
    if (!karta) return;
    clearTimeout(omraknare);
    omraknare = setTimeout(() => karta.invalidateSize(), 150);
  });
});

export function centreraPa(adress) {
  if (!karta || !adress.lat) return;
  karta.setView([adress.lat, adress.lon], 18);
}

export function egenPosition(lat, lon) {
  if (!karta) return;
  if (!jagMarkor) {
    jagMarkor = L.circleMarker([lat, lon], {
      radius: 7, color: '#ffffff', weight: 3, fillColor: '#1c1a17', fillOpacity: 1,
    }).addTo(karta).bindTooltip('Du');
  } else {
    jagMarkor.setLatLng([lat, lon]);
  }
  // Dörrarna har företräde; hoppa hit bara när det inte finns några att visa.
  if (!harCentrerat && !dorrLager.getLayers().length) {
    karta.setView([lat, lon], 17);
    harCentrerat = true;
  }
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
          html: '<div style="background:#8a6d23;color:#fff;font-size:10px;font-weight:700;' +
            'padding:3px 7px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35)">' +
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
