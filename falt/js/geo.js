/**
 * Adressuppslag mot OpenStreetMap, plus tolkning av inskrivna adresser.
 * Allt här är hjälp för att slippa knappa in gata och nummer för hand.
 */

/*
 * Uppslagen sparas medan appen är igång. Samma punkt eller samma söktext
 * frågas aldrig två gånger — tjänsten är gratis och delad, och varje sparat
 * anrop är ett anrop som inte kostar någon något.
 */
const cache = new Map();
const CACHE_TAK = 400;

function franCache(nyckel, hamta) {
  if (cache.has(nyckel)) return cache.get(nyckel);
  const loftet = hamta().catch((e) => { cache.delete(nyckel); throw e; });
  if (cache.size > CACHE_TAK) cache.delete(cache.keys().next().value);
  cache.set(nyckel, loftet);
  return loftet;
}

/** Postnummer som fem siffror utan mellanslag, annars tomt. */
const rensaPostnummer = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 5 ? d : '';
};

/** Plockar ut fälten vi bryr oss om ur ett Nominatim-svar. */
function tolkaAdress(data, lat, lon) {
  const a = (data && data.address) || {};
  return {
    gata: a.road || a.pedestrian || a.footway || a.residential || '',
    nummer: a.house_number || '',
    postnummer: rensaPostnummer(a.postcode),
    postort: a.city || a.town || a.village || a.hamlet || a.municipality || '',
    lat: Number(data && data.lat) || lat,
    lon: Number(data && data.lon) || lon,
    kalla: 'karta',
  };
}

/**
 * Vilken adress ligger på den här punkten? Används när säljaren trycker
 * på ett hus på kartan i stället för att skriva in adressen.
 *
 * Svaret kan sakna husnummer — då finns det inget husnummer i kartdatan på
 * den punkten, och det ska sägas rakt ut i stället för att gissas fram.
 */
export function adressVid(lat, lon) {
  // Fem decimaler ≈ 1 meter. Två tryck på samma hus blir ett uppslag.
  const nyckel = 'rev:' + Number(lat).toFixed(5) + ',' + Number(lon).toFixed(5);
  return franCache(nyckel, async () => {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18' +
      '&addressdetails=1&accept-language=sv&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    const svar = await fetch(url, { cache: 'no-store' });
    if (!svar.ok) throw new Error('Adressökningen svarade ' + svar.status);
    return tolkaAdress(await svar.json(), lat, lon);
  });
}

/**
 * Adressökning: "Björkvägen 17" → var det ligger. Sökningen är låst till
 * Sverige och ger flera förslag, för det finns en Björkväg i varje stad.
 */
export function sokAdress(text) {
  const fraga = String(text || '').trim();
  if (fraga.length < 3) return Promise.resolve([]);

  return franCache('sok:' + fraga.toLowerCase(), async () => {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6' +
      '&countrycodes=se&addressdetails=1&accept-language=sv&q=' + encodeURIComponent(fraga);
    const svar = await fetch(url, { cache: 'no-store' });
    if (!svar.ok) throw new Error('Adressökningen svarade ' + svar.status);
    const rader = await svar.json();
    return (Array.isArray(rader) ? rader : [])
      .map((r) => ({ ...tolkaAdress(r, Number(r.lat), Number(r.lon)), etikett: r.display_name || '' }))
      .filter((a) => a.gata);
  });
}

/**
 * Alla hus med husnummer inom en kartruta. Det är så kartan kan visa varje
 * hus i kvarteret utan att någon skrivit in dem — adressen finns redan i
 * OpenStreetMap, vi hämtar den bara.
 */
export async function husIRuta(syd, vast, norr, ost) {
  const ruta = [syd, vast, norr, ost].map((n) => n.toFixed(5)).join(',');
  const fraga =
    '[out:json][timeout:25];' +
    '(node["addr:housenumber"](' + ruta + ');' +
    ' way["addr:housenumber"](' + ruta + ');' +
    ' relation["addr:housenumber"](' + ruta + '););' +
    'out center;';

  const svar = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(fraga),
  });
  if (!svar.ok) throw new Error('Kartsökningen svarade ' + svar.status);
  const data = await svar.json();

  return (data.elements || []).map((e) => {
    const t = e.tags || {};
    return {
      gata: t['addr:street'] || '',
      nummer: t['addr:housenumber'] || '',
      postnummer: rensaPostnummer(t['addr:postcode']),
      postort: t['addr:city'] || t['addr:place'] || '',
      lat: e.lat || (e.center && e.center.lat),
      lon: e.lon || (e.center && e.center.lon),
    };
  }).filter((h) => h.nummer && h.lat && h.lon);
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
      postnummer: rensaPostnummer(e.tags && e.tags['addr:postcode']),
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

  // Resten är postnummer och postort; postnumret hör inte hemma i ortsnamnet,
  // men det ska tas till vara — det är en av uppgifterna vi vill ha.
  const svans = delar.slice(1).join(' ');
  const postnrTraff = svans.match(/\b(\d{3})\s?(\d{2})\b/);
  const postnummer = postnrTraff ? postnrTraff[1] + postnrTraff[2] : '';
  const postort = svans
    .replace(/\b\d{3}\s?\d{2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { gata, nummer, postnummer, postort };
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
