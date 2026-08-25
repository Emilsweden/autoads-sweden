/**
 * Adressuppslag mot OpenStreetMap, plus tolkning av inskrivna adresser.
 * Allt här är hjälp för att slippa knappa in gata och nummer för hand.
 */

/**
 * Vilken adress ligger på den här punkten? Används när säljaren trycker
 * på ett hus på kartan i stället för att skriva in adressen.
 */
export async function adressVid(lat, lon) {
  const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18' +
    '&addressdetails=1&accept-language=sv&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
  const svar = await fetch(url, { cache: 'no-store' });
  if (!svar.ok) throw new Error('Adressökningen svarade ' + svar.status);
  const data = await svar.json();
  const a = data.address || {};
  return {
    gata: a.road || a.pedestrian || a.footway || a.residential || '',
    nummer: a.house_number || '',
    postort: a.city || a.town || a.village || a.hamlet || a.municipality || '',
    lat: Number(data.lat) || lat,
    lon: Number(data.lon) || lon,
  };
}

/** Alla husnummer på en gata, för att fylla i koordinater i efterhand. */
export async function husnummerPaGata(gata, ort) {
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

/**
 * Delar upp en adress som skrivits eller klistrats in i ett fält,
 * t.ex. "Sippgatan 9, 942 33 Byske" → gata, nummer och postort var för sig.
 * Utan uppdelning hamnade hela texten i gatunamnet och dörren fick ett namn
 * som "Sippgatan 9, 94233 9".
 */
export function delaAdress(text) {
  const delar = String(text || '').split(',').map((d) => d.trim()).filter(Boolean);
  const forsta = delar[0] || '';

  // Husnumret sitter sist i första delen: "Sippgatan 9", "Storgatan 12 B".
  const m = forsta.match(/^(.*[^\d\s])\s+(\d+\s*[A-Za-zÅÄÖåäö]?)$/);
  const gata = (m ? m[1] : forsta).trim();
  const nummer = m ? m[2].replace(/\s+/g, ' ').trim() : '';

  // Resten är postnummer och postort; postnumret hör inte hemma i ortsnamnet.
  const postort = delar.slice(1).join(' ')
    .replace(/\b\d{3}\s?\d{2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { gata, nummer, postort };
}

/** iPhone och Mac öppnar Apple Kartor, övriga Google Maps. */
function arApple() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod|Macintosh/.test(ua);
}

/**
 * Länk till vägbeskrivning i telefonens kartapp. Koordinater används när de
 * finns — adresstexten kan vara feltolkad, punkten på kartan är den vi vet.
 */
export function vagbeskrivning(adress) {
  const text = [adress.adress || [adress.gata, adress.nummer].filter(Boolean).join(' '), adress.postort]
    .filter(Boolean).join(', ');
  const punkt = adress.lat && adress.lon ? adress.lat + ',' + adress.lon : '';

  if (arApple()) {
    return 'https://maps.apple.com/?dirflg=w&daddr=' + encodeURIComponent(punkt || text) +
      (punkt ? '&q=' + encodeURIComponent(text) : '');
  }
  return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' +
    encodeURIComponent(punkt || text);
}

/** Namnet på kartappen, så att knappen säger vart den leder. */
export function kartappNamn() {
  return arApple() ? 'Apple Kartor' : 'Google Maps';
}
