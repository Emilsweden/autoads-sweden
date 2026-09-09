/**
 * Autoads Fältsystem — API för dörrknackning, områdeskontroll och
 * bokning av takbesiktningar.
 *
 * Cloudflare Worker + D1. Alla anrop är POST /api/<namn> med JSON-body.
 * Inloggning sker med e-post och lösenord, därefter skickas sessionstoken
 * som "Authorization: Bearer <token>".
 */

const RESULTAT = ['bokat', 'ejsvar', 'nej', 'aterkom'];

/**
 * Rollerna, med nycklarna databasen alltid haft och namnen laget använder:
 *
 *   saljare      Mötesbokare — knackar dörr och bokar möten
 *   bokare_plus  Mötesbokare+ — samma jobb, plus hela överblicken och
 *                ansvaret för mötesbokarnas konton
 *   besiktare    Säljare / Takbesiktare — kör mötena och återkopplar
 *   saljadmin    Admin Säljare — styr säljarnas tider och ser deras utfall
 *   teamleader   ser och gör allt utom att lägga upp administratörer
 *   admin        allt
 *
 * Rangen avgör de gamla kontrollerna (kraver). Det som skiljer rollerna åt i
 * sidled — vem som får styra tider, se allt eller skapa konton — ligger i
 * förmågorna nedan, för en rang på en linje kan inte beskriva det.
 */
const ROLLER = {
  besiktare: 1,
  saljare: 1,
  saljadmin: 2,
  bokare_plus: 2,
  teamleader: 3,
  admin: 4,
};

const ROLLNAMN = {
  saljare: 'Mötesbokare',
  bokare_plus: 'Mötesbokare+',
  besiktare: 'Säljare',
  saljadmin: 'Admin Säljare',
  teamleader: 'Teamleader',
  admin: 'Admin',
};

/**
 * knacka            karta, adressregister, dörrbesök, statistik
 * boka              lägga en bokning
 * se_tider          se säljarnas lediga tider och vem de tillhör
 * styr_tider        lägga till och ta bort tider åt alla säljare
 * eget_schema       styra sina egna tider
 * allt_bokat        se alla bokningar, inte bara sina egna
 * aterkoppla        skriva återkoppling på ett möte
 * all_aterkoppling  se all återkoppling
 * skapa_bokare      lägga upp och ändra mötesbokare
 * se_personal       se vilka som finns i laget
 */
const FORMAGOR = {
  saljare: ['knacka', 'boka', 'se_tider'],
  bokare_plus: ['knacka', 'boka', 'se_tider', 'styr_tider', 'allt_bokat',
    'all_aterkoppling', 'skapa_bokare', 'se_personal'],
  besiktare: ['se_tider', 'eget_schema', 'aterkoppla', 'egna_moten'],
  saljadmin: ['se_tider', 'styr_tider', 'allt_bokat', 'all_aterkoppling', 'se_personal'],
  teamleader: ['*'],
  admin: ['*'],
};

const far = (anv, formaga) => {
  const lista = FORMAGOR[anv && anv.roll] || [];
  return lista.includes('*') || lista.includes(formaga);
};

function kraverFormaga(anv, formaga) {
  if (!far(anv, formaga)) throw new Fel('Du har inte behörighet till detta', 403);
}

/** Säljaren/takbesiktaren jobbar bara i sina möten — inte på kartan. */
const arBesiktare = (anv) => anv && anv.roll === 'besiktare';
const SESSION_DAGAR = 30;
const DAG = 86400000;

/* ══ Grundverktyg ══ */

/**
 * Alla adresser tillåts. Skyddet ligger i inloggningen: sessionen skickas i
 * anropets kropp och inte i en kaka, så en främmande sajt kan inte rida på
 * någons inloggning. Med en vitlista slutade appen i stället fungera varje
 * gång den nåddes från en ny adress.
 */
function cors(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function svar(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

class Fel extends Error {
  constructor(meddelande, status = 400) { super(meddelande); this.status = status; }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function franHex(s) {
  const ut = new Uint8Array(s.length / 2);
  for (let i = 0; i < ut.length; i++) ut[i] = parseInt(s.substr(i * 2, 2), 16);
  return ut;
}

async function hasha(losenord, saltHex) {
  const nyckel = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(losenord), 'PBKDF2', false, ['deriveBits']
  );
  const bitar = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: franHex(saltHex), iterations: 100000, hash: 'SHA-256' },
    nyckel, 256
  );
  return hex(bitar);
}

function lika(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const txt = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const nr = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const datum = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const klockslag = (v) => (/^\d{2}:\d{2}$/.test(v || '') ? v : null);

/* ══ Kalender ══
   Besiktningarna bokas i rutor. Ändras SLOT här ändras hela kalendern,
   både serverns kontroll och rutnätet i appen som hämtar värdena härifrån. */
const KALENDER = {
  OPPNAR: '08:00',
  SISTA: '20:00',    // sista tiden som går att boka
  SLOT: 60,          // minuter
  DAGAR: [1, 2, 3, 4, 5],   // måndag–fredag
};

const iMinuter = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const iKlockslag = (m) =>
  String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** Alla bokningsbara tider på en dag, från öppning till sista tiden. */
function slottar() {
  const ut = [];
  for (let m = iMinuter(KALENDER.OPPNAR); m <= iMinuter(KALENDER.SISTA); m += KALENDER.SLOT) {
    ut.push(iKlockslag(m));
  }
  return ut;
}

/** Veckodag 0–6 för ett datum, uträknat utan tidszon. */
function veckodag(d) {
  return new Date(d + 'T12:00:00Z').getUTCDay();
}

/**
 * Kontrollerar tiden på servern, inte bara i appen: helg, utanför öppettid
 * och tider mitt i en ruta avvisas oavsett vad klienten skickar.
 */
function kontrolleraSlot(dat, tid) {
  if (!datum(dat) || !klockslag(tid)) throw new Fel('Datum och tid krävs');
  if (!KALENDER.DAGAR.includes(veckodag(dat))) throw new Fel('Helger går inte att boka');
  const m = iMinuter(tid);
  if (m < iMinuter(KALENDER.OPPNAR) || m > iMinuter(KALENDER.SISTA)) {
    throw new Fel('Tiden ligger utanför ' + KALENDER.OPPNAR + '–' + KALENDER.SISTA);
  }
  if ((m - iMinuter(KALENDER.OPPNAR)) % KALENDER.SLOT !== 0) {
    throw new Fel('Tiden måste börja på en hel ' + KALENDER.SLOT + '-minutersruta');
  }
}

const TIDEN_TAGEN = 'Tiden är redan bokad – välj en annan tid';
const TIDEN_STANGD = 'Säljaren är inte tillgänglig den tiden';

/** Säljarna (takbesiktarna) möten kan bokas på. */
function saljarlista(env) {
  return alla(env,
    "SELECT id, namn FROM anvandare WHERE roll = 'besiktare' AND aktiv = 1 ORDER BY namn");
}

/**
 * Säljarens tider en viss dag.
 *
 * Har säljaren ingen rad alls för datumet är hela standarddagen ledig — så
 * beter sig kalendern som den alltid gjort för den som inte lagt in något.
 * Har säljaren lagt in tider gäller bara de.
 */
async function tiderForSaljare(env, saljareId, dat) {
  const standard = KALENDER.DAGAR.includes(veckodag(dat)) ? slottar() : [];
  if (!saljareId) return standard;
  const rader = await alla(env,
    'SELECT tid, ledig FROM saljartider WHERE saljare_id = ?1 AND datum = ?2', saljareId, dat);
  if (!rader.length) return standard;
  return rader.filter((r) => nr(r.ledig)).map((r) => r.tid).sort();
}

/** Är rutan öppen hos säljaren? */
async function tidOppen(env, saljareId, dat, tid) {
  return (await tiderForSaljare(env, saljareId, dat)).includes(tid);
}

/**
 * Är rutan ledig hos säljaren? Databasens unika index är den slutliga
 * garantin; det här är kontrollen som ger ett begripligt fel i stället.
 * Bokningar utan säljare är från tiden före säljarvalet och håller sin egen
 * ruta, precis som förr.
 */
async function slotLedig(env, dat, tid, saljareId, utom) {
  const rad = await en(env,
    `SELECT id FROM bokningar
     WHERE datum = ?1 AND tid = ?2 AND status <> 'avbokad' AND id <> ?3
       AND ((?4 IS NOT NULL AND saljare_id = ?4) OR (?4 IS NULL AND saljare_id IS NULL))`,
    dat, tid, utom || '', saljareId || null);
  return !rad;
}

/**
 * Vilken säljare mötet ska bokas på. Skickar appen ingen, och det bara finns
 * en säljare, blir det han — annars ingen, som förut.
 */
async function valjSaljare(env, onskad) {
  const id = txt(onskad, 40);
  const lista = await saljarlista(env);
  if (id) {
    if (!lista.some((s) => s.id === id)) throw new Fel('Okänd säljare');
    return id;
  }
  return lista.length === 1 ? lista[0].id : null;
}

/** Känner igen krocken med det unika indexet, oavsett hur D1 formulerar den. */
const arKrock = (e) => /UNIQUE|constraint/i.test(String((e && e.message) || e));

/**
 * Skriver en rad i nyhetsflödet. anvandare_id är den som gjorde saken och
 * saljare_id säljaren det rör — tillsammans avgör de vem som får se raden.
 */
function nyhet(env, typ, text, extra = {}) {
  return kor(env,
    `INSERT INTO nyheter (id,typ,text,bokning_id,saljare_id,anvandare_id,skapad)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`,
    uid(), typ, String(text).slice(0, 400), extra.bokning_id || null,
    extra.saljare_id || null, extra.anvandare_id || null, Date.now());
}

/** "Törngatan 16" ur en bokningsrad, för texten i flödet. */
const kortAdress = (b) => (b && b.gata ? b.gata + ' ' + b.nummer : 'adressen');

/**
 * Villkoret som avgör vilka bokningar en användare får se:
 *
 *   Mötesbokare+, Admin Säljare, teamleader, admin   alla
 *   Mötesbokare                                      de han själv bokat
 *   Säljare                                          mötena han ska köra
 *
 * Är han lagets enda säljare räknas också de gamla bokningarna utan säljare
 * som hans — de gjordes innan bokningen hade en säljare alls.
 */
function fyllPlatshallare(sql, varden, args) {
  let i = 0;
  return sql.replace(/\?/g, () => '?' + args.push(varden[i++]));
}

async function bokningsvillkor(env, anv) {
  if (far(anv, 'allt_bokat')) return { sql: '1=1', args: [] };
  if (arBesiktare(anv)) {
    const lista = await saljarlista(env);
    const ensam = lista.length === 1 && lista[0].id === anv.id;
    return ensam
      ? { sql: '(b.saljare_id = ? OR b.saljare_id IS NULL)', args: [anv.id] }
      : { sql: 'b.saljare_id = ?', args: [anv.id] };
  }
  return { sql: '(b.anvandare_id = ? OR b.saljare_id = ?)', args: [anv.id, anv.id] };
}

/** Samma regel, men på en färdig rad. */
async function farSeBokning(env, anv, bokning) {
  if (far(anv, 'allt_bokat')) return true;
  if (bokning.anvandare_id === anv.id || bokning.saljare_id === anv.id) return true;
  if (arBesiktare(anv) && !bokning.saljare_id) {
    const lista = await saljarlista(env);
    return lista.length === 1 && lista[0].id === anv.id;
  }
  return false;
}

async function kraverBokning(env, anv, bokning) {
  if (!(await farSeBokning(env, anv, bokning))) {
    throw new Fel('Bokningen tillhör någon annan', 403);
  }
}

/* Databashjälpare */
const alla = async (env, sql, ...a) => ((await env.DB.prepare(sql).bind(...a).all()).results || []);
const en = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const kor = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).run();

/**
 * Normaliserar en adress till en unik nyckel så att "Västeråsvägen 1",
 * "västeråsvägen 1 " och "Västeråsvägen  1" blir samma dörr.
 *
 * Även mellanslag och bindestreck tas bort: anteckningar skrivs "Vinkel gatan"
 * där registret har "Vinkelgatan", och det är samma dörr.
 */
function adressnyckel(gata, nummer, postort) {
  const rensa = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^0-9a-zåäöæøéèüö]/gi, '');
  return [rensa(gata), rensa(nummer), rensa(postort)].join('|');
}

/** Nyckelformen som användes innan mellanslagen togs bort. */
function gammalNyckel(gata, nummer, postort) {
  const rensa = (s) => String(s || '')
    .toLowerCase()
    .replace(/[.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [rensa(gata), rensa(nummer).replace(/\s+/g, ''), rensa(postort)].join('|');
}

/**
 * Städar upp hur adressen skrivs utan att hitta på ett nytt namn:
 * extra mellanslag bort, och VERSALER blir normal skrift.
 */
function snyggText(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t || t !== t.toUpperCase() || !/[a-zåäöA-ZÅÄÖ]/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s\-])([a-zåäö])/g, (m, f, b) => f + b.toUpperCase());
}

/**
 * Letar upp en dörr oavsett hur adressen råkade skrivas: ny och gammal
 * nyckelform, och med eller utan postort.
 */
async function hittaAdress(env, gata, nummer, postort) {
  const kandidater = [adressnyckel(gata, nummer, postort), gammalNyckel(gata, nummer, postort)];
  if (postort) kandidater.push(adressnyckel(gata, nummer, ''), gammalNyckel(gata, nummer, ''));

  const p = kandidater.map((_, i) => '?' + (i + 1)).join(',');
  const rad = await en(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     WHERE a.nyckel IN (${p}) ORDER BY a.skapad LIMIT 1`, ...kandidater);
  if (rad) return rad;

  // Skrevs adressen utan ort är dörren med ort ändå samma dörr.
  if (postort) return null;
  return en(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     WHERE a.nyckel LIKE ?1 ORDER BY a.skapad LIMIT 1`,
    adressnyckel(gata, nummer, '') + '%');
}

/* ══ Inställningar ══ */

async function installningar(env) {
  const rader = await alla(env, 'SELECT nyckel, varde FROM installningar');
  const ut = {};
  for (const r of rader) ut[r.nyckel] = r.varde;
  return ut;
}

/** Hur länge dörren ska vara fredad efter ett visst resultat. */
function sparrTill(resultat, aterkomDatum, inst, nu) {
  if (resultat === 'aterkom') {
    // Fredad fram till den tidpunkt säljaren valt att återkomma.
    return aterkomDatum ? new Date(aterkomDatum + 'T00:00:00Z').getTime() : nu;
  }
  const dagar = nr(inst['sparr_' + resultat], 0);
  return nu + dagar * DAG;
}

/* ══ Inloggning och behörighet ══ */

/** Sessionen kommer i kroppen (enkel förfrågan) eller i Authorization-headern. */
function tokenFran(request, body) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return txt(body && body.token, 128) || '';
}

async function anvandareFranToken(env, request, body) {
  const token = tokenFran(request, body);
  if (!token) throw new Fel('Inte inloggad', 401);

  const rad = await en(env,
    `SELECT a.* FROM sessioner s JOIN anvandare a ON a.id = s.anvandare_id
     WHERE s.token = ?1 AND s.giltig_till > ?2 AND a.aktiv = 1`,
    token, Date.now()
  );
  if (!rad) throw new Fel('Sessionen har gått ut — logga in igen', 401);
  return rad;
}

/** Rangen för en roll. Okänd roll ger 0, så en trasig roll aldrig öppnar något. */
function rang(roll) {
  return Object.prototype.hasOwnProperty.call(ROLLER, roll) ? ROLLER[roll] : 0;
}

function kraver(anv, roll) {
  if (rang(anv && anv.roll) < ROLLER[roll]) throw new Fel('Du har inte behörighet till detta', 403);
}

/**
 * Kartan, adressregistret och statistiken är mötesbokarnas. Kontrollen ligger
 * här och inte bara i menyn — appen är bara en av vägarna in till API:t.
 */
function kraverKnackare(anv) {
  if (!far(anv, 'knacka')) throw new Fel('Den här delen är mötesbokarnas', 403);
}

/** Områdes-id:n användaren får röra. */
async function synligaOmradesIdn(env, anv) {
  return (await synligaOmraden(env, anv)).map((o) => o.id);
}

/**
 * Hämtar en adress och kontrollerar att den ligger i ett område användaren
 * har. Utan den kunde vilket inloggat konto som helst läsa och skriva på
 * dörrar i andras områden bara genom att gissa eller plocka upp ett id.
 */
async function adressJagFar(env, anv, id, extra) {
  const adress = await en(env, extra || 'SELECT * FROM adresser WHERE id = ?1', id);
  if (!adress) throw new Fel('Adressen finns inte', 404);
  if (rang(anv.roll) >= ROLLER.teamleader) return adress;
  const idn = await synligaOmradesIdn(env, anv);
  if (!idn.includes(adress.omrade_id)) throw new Fel('Adressen ligger utanför dina områden', 403);
  return adress;
}

/** Områden användaren får se: tilldelade områden, plus otilldelade. Admin ser allt. */
async function synligaOmraden(env, anv) {
  if (rang(anv.roll) >= ROLLER.teamleader) {
    return alla(env, 'SELECT * FROM omraden ORDER BY namn');
  }
  return alla(env,
    `SELECT o.* FROM omraden o
     WHERE o.id IN (SELECT omrade_id FROM omrade_saljare WHERE anvandare_id = ?1)
        OR o.id NOT IN (SELECT omrade_id FROM omrade_saljare)
     ORDER BY o.namn`,
    anv.id
  );
}

/* ══ Endpoints ══ */

const api = {};

/* ── Konto ── */

api['logga-in'] = async (env, request, body) => {
  const epost = (txt(body.epost, 160) || '').toLowerCase();
  const losenord = String(body.losenord || '');
  if (!epost || !losenord) throw new Fel('Fyll i e-post och lösenord');

  const anv = await en(env, 'SELECT * FROM anvandare WHERE epost = ?1 AND aktiv = 1', epost);
  // Räknar alltid ut en hash, även för okänd e-post, så att svarstiden inte skvallrar.
  const salt = anv ? anv.salt : '00'.repeat(16);
  const test = await hasha(losenord, salt);
  if (!anv || !lika(test, anv.hash)) throw new Fel('Fel e-post eller lösenord', 401);

  const token = uid() + hex(crypto.getRandomValues(new Uint8Array(24)));
  await kor(env, 'INSERT INTO sessioner (token, anvandare_id, giltig_till) VALUES (?1,?2,?3)',
    token, anv.id, Date.now() + SESSION_DAGAR * DAG);
  await kor(env, 'DELETE FROM sessioner WHERE giltig_till < ?1', Date.now());

  return { token, anvandare: omAnvandaren(anv) };
};

api['logga-ut'] = async (env, request, body) => {
  const token = tokenFran(request, body);
  if (token) await kor(env, 'DELETE FROM sessioner WHERE token = ?1', token);
  return {};
};

api['jag'] = async (env, request, body, anv) => ({
  anvandare: omAnvandaren(anv),
  installningar: await installningar(env),
  omraden: far(anv, 'knacka') ? await synligaOmraden(env, anv) : [],
});

/**
 * Det appen behöver veta om den inloggade. Förmågorna följer med, så att
 * menyer och knappar visar samma sak som servern faktiskt tillåter — och
 * bara det: kontrollen ligger kvar på servern.
 */
const omAnvandaren = (anv) => ({
  id: anv.id,
  namn: anv.namn,
  epost: anv.epost,
  roll: anv.roll,
  rollnamn: ROLLNAMN[anv.roll] || anv.roll,
  team: anv.team,
  formagor: FORMAGOR[anv.roll] || [],
});

api['byt-losenord'] = async (env, request, body, anv) => {
  const nytt = String(body.nytt || '');
  if (nytt.length < 8) throw new Fel('Lösenordet måste vara minst 8 tecken');
  const gammalt = await hasha(String(body.gammalt || ''), anv.salt);
  if (!lika(gammalt, anv.hash)) throw new Fel('Fel nuvarande lösenord', 401);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await kor(env, 'UPDATE anvandare SET hash = ?1, salt = ?2 WHERE id = ?3', await hasha(nytt, salt), salt, anv.id);

  // Byter du lösenord ska en telefon som någon annan har kvar sluta fungera.
  // Alla sessioner slängs och den som byter får en ny på plats.
  await kor(env, 'DELETE FROM sessioner WHERE anvandare_id = ?1', anv.id);
  const token = uid() + hex(crypto.getRandomValues(new Uint8Array(24)));
  await kor(env, 'INSERT INTO sessioner (token, anvandare_id, giltig_till) VALUES (?1,?2,?3)',
    token, anv.id, Date.now() + SESSION_DAGAR * DAG);
  return { token };
};

/* ── Användare (admin) ── */

api['anvandare-lista'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'se_personal');
  return {
    roller: ROLLNAMN,
    anvandare: await alla(env,
      'SELECT id, namn, epost, roll, team, aktiv, skapad FROM anvandare ORDER BY roll DESC, namn'),
  };
};

/**
 * Mötesbokare+ lägger upp och sköter sina mötesbokare — men bara dem.
 * Rollen sätts av servern, så en trimmad förfrågan kan inte göra en
 * mötesbokare till admin, och konton med andra roller går inte att röra
 * härifrån.
 */
api['bokare-spara'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'skapa_bokare');
  const namn = txt(body.namn, 80);
  const epost = (txt(body.epost, 160) || '').toLowerCase();
  if (!namn || !epost) throw new Fel('Namn och e-post krävs');

  if (body.id) {
    const finns = await en(env, 'SELECT * FROM anvandare WHERE id = ?1', txt(body.id, 40));
    if (!finns) throw new Fel('Användaren finns inte', 404);
    if (finns.roll !== 'saljare') throw new Fel('Du kan bara ändra mötesbokare', 403);
    await kor(env,
      "UPDATE anvandare SET namn=?1, epost=?2, team=?3, aktiv=?4 WHERE id=?5 AND roll='saljare'",
      namn, epost, txt(body.team, 60), body.aktiv === false ? 0 : 1, finns.id);
    if (body.losenord) {
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      if (String(body.losenord).length < 8) throw new Fel('Lösenordet måste vara minst 8 tecken');
      await kor(env, 'UPDATE anvandare SET hash=?1, salt=?2 WHERE id=?3',
        await hasha(String(body.losenord), salt), salt, finns.id);
      await kor(env, 'DELETE FROM sessioner WHERE anvandare_id = ?1', finns.id);
    }
    await nyhet(env, 'konto', anv.namn + ' ändrade mötesbokaren ' + namn, { anvandare_id: anv.id });
    return { id: finns.id };
  }

  const losenord = String(body.losenord || '');
  if (losenord.length < 8) throw new Fel('Lösenordet måste vara minst 8 tecken');
  if (await en(env, 'SELECT id FROM anvandare WHERE epost = ?1', epost)) {
    throw new Fel('E-postadressen används redan');
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const id = uid();
  await kor(env,
    "INSERT INTO anvandare (id,namn,epost,roll,team,hash,salt,aktiv,skapad) VALUES (?1,?2,?3,'saljare',?4,?5,?6,1,?7)",
    id, namn, epost, txt(body.team, 60), await hasha(losenord, salt), salt, Date.now());
  await nyhet(env, 'konto', anv.namn + ' lade upp mötesbokaren ' + namn, { anvandare_id: anv.id });
  return { id };
};

api['anvandare-spara'] = async (env, request, body, anv) => {
  kraver(anv, 'admin');
  const namn = txt(body.namn, 80);
  const epost = (txt(body.epost, 160) || '').toLowerCase();
  const roll = Object.prototype.hasOwnProperty.call(ROLLER, body.roll) ? body.roll : 'saljare';
  if (!namn || !epost) throw new Fel('Namn och e-post krävs');

  if (body.id) {
    await kor(env, 'UPDATE anvandare SET namn=?1, epost=?2, roll=?3, team=?4, aktiv=?5 WHERE id=?6',
      namn, epost, roll, txt(body.team, 60), body.aktiv === false ? 0 : 1, body.id);
    if (body.losenord) {
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      await kor(env, 'UPDATE anvandare SET hash=?1, salt=?2 WHERE id=?3',
        await hasha(String(body.losenord), salt), salt, body.id);
      await kor(env, 'DELETE FROM sessioner WHERE anvandare_id = ?1', body.id);
    }
    return { id: body.id };
  }

  const losenord = String(body.losenord || '');
  if (losenord.length < 8) throw new Fel('Lösenordet måste vara minst 8 tecken');
  if (await en(env, 'SELECT id FROM anvandare WHERE epost = ?1', epost)) {
    throw new Fel('E-postadressen används redan');
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const id = uid();
  await kor(env,
    'INSERT INTO anvandare (id,namn,epost,roll,team,hash,salt,aktiv,skapad) VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8)',
    id, namn, epost, roll, txt(body.team, 60), await hasha(losenord, salt), salt, Date.now());
  return { id };
};

/* ── Områden ── */

api['omraden'] = async (env, request, body, anv) => {
  const omraden = await synligaOmraden(env, anv);
  const stat = await alla(env,
    `SELECT omrade_id,
            COUNT(*) AS totalt,
            SUM(CASE WHEN status = 'ejbesokt' THEN 1 ELSE 0 END) AS ejbesokta
     FROM adresser GROUP BY omrade_id`);
  const tilldelade = await alla(env,
    `SELECT os.omrade_id, a.id, a.namn FROM omrade_saljare os
     JOIN anvandare a ON a.id = os.anvandare_id`);

  const karta = {};
  for (const s of stat) karta[s.omrade_id] = s;

  return {
    omraden: omraden.map((o) => {
      const s = karta[o.id] || { totalt: 0, ejbesokta: 0 };
      const totalt = nr(s.totalt), ejbesokta = nr(s.ejbesokta);
      return {
        ...o,
        totalt,
        ejbesokta,
        besokta: totalt - ejbesokta,
        procent: totalt ? Math.round(((totalt - ejbesokta) / totalt) * 100) : 0,
        saljare: tilldelade.filter((t) => t.omrade_id === o.id).map((t) => ({ id: t.id, namn: t.namn })),
      };
    }),
  };
};

api['omrade-spara'] = async (env, request, body, anv) => {
  kraver(anv, 'teamleader');
  const namn = txt(body.namn, 120);
  if (!namn) throw new Fel('Områdesnamn krävs');
  if (body.id) {
    await kor(env, 'UPDATE omraden SET namn=?1, ort=?2 WHERE id=?3', namn, txt(body.ort, 80), body.id);
    return { id: body.id };
  }
  const id = uid();
  await kor(env, 'INSERT INTO omraden (id,namn,ort,skapad) VALUES (?1,?2,?3,?4)',
    id, namn, txt(body.ort, 80), Date.now());
  return { id };
};

api['omrade-tilldela'] = async (env, request, body, anv) => {
  kraver(anv, 'teamleader');
  const omradeId = txt(body.omrade_id, 40);
  if (!omradeId) throw new Fel('Område saknas');
  const saljare = Array.isArray(body.saljare) ? body.saljare.slice(0, 100) : [];
  await kor(env, 'DELETE FROM omrade_saljare WHERE omrade_id = ?1', omradeId);
  for (const s of saljare) {
    await kor(env, 'INSERT OR IGNORE INTO omrade_saljare (omrade_id, anvandare_id) VALUES (?1,?2)',
      omradeId, txt(s, 40));
  }
  return {};
};

/**
 * Importerar adresser till ett område. Adresser som redan finns hoppas över
 * tack vare den unika nyckeln — samma hus kan aldrig bli två rader.
 */
api['adresser-importera'] = async (env, request, body, anv) => {
  kraver(anv, 'teamleader');
  const omradeId = txt(body.omrade_id, 40);
  if (!omradeId) throw new Fel('Område saknas');
  if (!(await en(env, 'SELECT id FROM omraden WHERE id = ?1', omradeId))) throw new Fel('Okänt område');

  const inkomna = Array.isArray(body.adresser) ? body.adresser.slice(0, 2000) : [];
  const nu = Date.now();
  let nya = 0, fanns = 0;

  for (const a of inkomna) {
    const gata = snyggText(txt(a.gata, 120));
    const nummer = txt(a.nummer, 20).replace(/\s+/g, ' ').trim();
    if (!gata || !nummer) continue;
    const postort = snyggText(txt(a.postort, 80));
    const nyckel = adressnyckel(gata, nummer, postort);

    const befintlig = await hittaAdress(env, gata, nummer, postort);
    if (befintlig) {
      fanns++;
      // Fyll på med koordinater om den gamla raden saknar dem.
      if (a.lat && a.lon) {
        await kor(env, 'UPDATE adresser SET lat = COALESCE(lat, ?1), lon = COALESCE(lon, ?2) WHERE id = ?3',
          nr(a.lat, null), nr(a.lon, null), befintlig.id);
      }
      continue;
    }
    await kor(env,
      `INSERT INTO adresser (id,omrade_id,gata,nummer,postort,nyckel,lat,lon,status,skapad)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ejbesokt',?9)`,
      uid(), omradeId, gata, nummer, postort, nyckel,
      a.lat === undefined ? null : nr(a.lat, null), a.lon === undefined ? null : nr(a.lon, null), nu);
    nya++;
  }
  return { nya, fanns };
};

/* ── Adresser och dörrar ── */

api['adresser'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const omradeId = txt(body.omrade_id, 40);
  const synliga = await synligaOmraden(env, anv);
  const idn = synliga.map((o) => o.id);
  if (!idn.length) return { adresser: [], omraden: [] };

  const valda = omradeId && idn.includes(omradeId) ? [omradeId] : idn;
  const platshallare = valda.map((_, i) => '?' + (i + 1)).join(',');
  const rader = await alla(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     WHERE a.omrade_id IN (${platshallare})
     ORDER BY a.gata, CAST(a.nummer AS INTEGER), a.nummer
     LIMIT 5000`,
    ...valda);

  return { adresser: rader.map(putsaAdress), omraden: synliga };
};

function putsaAdress(a) {
  return {
    id: a.id,
    omrade_id: a.omrade_id,
    gata: a.gata,
    nummer: a.nummer,
    postort: a.postort,
    adress: a.gata + ' ' + a.nummer,
    lat: a.lat,
    lon: a.lon,
    status: a.status,
    senast_tid: a.senast_tid,
    senast_av: a.senast_av,
    senast_namn: a.senast_namn || null,
    senast_resultat: a.senast_resultat,
    sparrad_till: a.sparrad_till,
    aterkom_datum: a.aterkom_datum,
    aterkom_tid: a.aterkom_tid,
    antal_besok: a.antal_besok,
  };
}

api['adress'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const id = txt(body.id, 40);
  const adress = await adressJagFar(env, anv, id,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av WHERE a.id = ?1`);

  const historik = await alla(env,
    `SELECT h.*, u.namn AS saljare FROM handelser h
     LEFT JOIN anvandare u ON u.id = h.anvandare_id
     WHERE h.adress_id = ?1 ORDER BY h.skapad DESC LIMIT 100`, id);

  const bokningar = await alla(env,
    `SELECT b.*, u.namn AS saljare FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     WHERE b.adress_id = ?1 ORDER BY b.datum DESC, b.tid DESC LIMIT 50`, id);

  return { adress: putsaAdress(adress), historik, bokningar };
};

/**
 * Registrerar ett dörrbesök. Detta är appens mest använda anrop och
 * uppdaterar både historiken, dörrens status och spärren.
 */
api['handelse'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const adressId = txt(body.adress_id, 40);
  const resultat = RESULTAT.includes(body.resultat) ? body.resultat : null;
  if (!adressId || !resultat) throw new Fel('Adress och resultat krävs');

  const adress = await adressJagFar(env, anv, adressId);

  const nu = Date.now();
  const inst = await installningar(env);

  // Spärrad dörr kräver ett aktivt godkännande från säljaren.
  if (adress.sparrad_till > nu && !body.bekrafta) {
    const sedan = adress.senast_tid ? Math.round((nu - adress.senast_tid) / DAG) : null;
    throw new Fel(JSON.stringify({
      sparrad: true,
      senast_resultat: adress.senast_resultat,
      senast_tid: adress.senast_tid,
      dagar_sedan: sedan,
      sparrad_till: adress.sparrad_till,
    }), 409);
  }

  // Bokas en tid ska rutan kontrolleras innan något skrivs — annars kunde
  // ett besök hamna i historiken utan den bokning säljaren trodde sig göra.
  const bokTid = resultat === 'bokat' ? klockslag(body.tid) : null;
  const bokDatum = resultat === 'bokat' ? datum(body.datum) : null;
  const bokSaljare = resultat === 'bokat' ? await valjSaljare(env, body.saljare_id) : null;
  if (bokTid && bokDatum) {
    kontrolleraSlot(bokDatum, bokTid);
    if (bokSaljare && !(await tidOppen(env, bokSaljare, bokDatum, bokTid))) {
      throw new Fel(TIDEN_STANGD, 409);
    }
    if (!(await slotLedig(env, bokDatum, bokTid, bokSaljare))) throw new Fel(TIDEN_TAGEN, 409);
  }

  const aterkomDatum = datum(body.aterkom_datum);
  const oppnade = resultat === 'ejsvar' ? 0 : 1;
  const positiv = resultat === 'bokat' || resultat === 'aterkom' ? 1 : 0;
  const handelseId = uid();

  await kor(env,
    `INSERT INTO handelser
       (id,adress_id,anvandare_id,resultat,orsak,oppnade,positiv,aterkom_datum,aterkom_tid,kommentar,lat,lon,skapad)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
    handelseId, adressId, anv.id, resultat, txt(body.orsak, 80), oppnade, positiv,
    aterkomDatum, klockslag(body.aterkom_tid), txt(body.kommentar, 1000),
    body.lat === undefined ? null : nr(body.lat, null),
    body.lon === undefined ? null : nr(body.lon, null), nu);

  const status = resultat === 'bokat' ? 'bokat'
    : resultat === 'nej' ? 'nej'
    : resultat === 'aterkom' ? 'aterkom' : 'ejsvar';

  await kor(env,
    `UPDATE adresser SET status=?1, senast_tid=?2, senast_av=?3, senast_resultat=?4,
       sparrad_till=?5, aterkom_datum=?6, aterkom_tid=?7, antal_besok=antal_besok+1
     WHERE id=?8`,
    status, nu, anv.id, resultat, sparrTill(resultat, aterkomDatum, inst, nu),
    aterkomDatum, klockslag(body.aterkom_tid), adressId);

  let bokning = null;
  if (resultat === 'bokat') {
    const bokningId = uid();
    try {
      await kor(env,
        `INSERT INTO bokningar
           (id,adress_id,handelse_id,anvandare_id,fornamn,efternamn,telefon,datum,tid,
            saljare_id,kommentar,status,skapad)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'bokad',?12)`,
        bokningId, adressId, handelseId, anv.id,
        txt(body.fornamn, 80), txt(body.efternamn, 80), txt(body.telefon, 40),
        bokDatum, bokTid, bokSaljare, txt(body.kommentar, 1000), nu);
    } catch (e) {
      // Någon annan hann boka rutan mellan kontrollen och skrivningen.
      // Besöket rullas tillbaka så att säljaren kan välja en ny tid.
      if (!arKrock(e)) throw e;
      await kor(env, 'DELETE FROM handelser WHERE id = ?1', handelseId);
      await raknaOmDorr(env, adressId);
      throw new Fel(TIDEN_TAGEN, 409);
    }
    bokning = { id: bokningId, saljare_id: bokSaljare };
    await nyhet(env, 'bokning',
      anv.namn + ' bokade ' + adress.gata + ' ' + adress.nummer +
      (bokDatum ? ' — ' + bokDatum + (bokTid ? ' kl. ' + bokTid : '') : ''),
      { bokning_id: bokningId, saljare_id: bokSaljare, anvandare_id: anv.id });
  }

  return { handelse_id: handelseId, bokning, status };
};

/**
 * Skapar en adress på plats när säljaren står vid en dörr som inte finns i
 * området — t.ex. en manuell bokning. Finns adressen redan återanvänds den,
 * så att historiken hänger ihop och inga dubbletter uppstår.
 */
api['adress-ny'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const gata = snyggText(txt(body.gata, 120));
  const nummer = txt(body.nummer, 20).replace(/\s+/g, ' ').trim();
  if (!gata || !nummer) throw new Fel('Gata och husnummer krävs');
  const postort = snyggText(txt(body.postort, 80));
  const nyckel = adressnyckel(gata, nummer, postort);

  const befintlig = await hittaAdress(env, gata, nummer, postort);
  if (befintlig) {
    // Dörren fanns men saknade läge eller ort — inklistrade adresser gör det.
    // Trycker säljaren på huset på kartan vet vi var den ligger och sparar det.
    const satt = [];
    const varden = [];
    if (!befintlig.lat && body.lat !== undefined && body.lon !== undefined) {
      satt.push('lat=?' + (varden.push(nr(body.lat, null))), 'lon=?' + (varden.push(nr(body.lon, null))));
      befintlig.lat = nr(body.lat, null);
      befintlig.lon = nr(body.lon, null);
    }
    if (!befintlig.postort && postort) {
      satt.push('postort=?' + (varden.push(postort)), 'nyckel=?' + (varden.push(nyckel)));
      befintlig.postort = postort;
    }
    if (satt.length) {
      await kor(env, 'UPDATE adresser SET ' + satt.join(', ') + ' WHERE id=?' + (varden.push(befintlig.id)), ...varden);
    }
    return { adress: putsaAdress(befintlig), fanns: true };
  }

  // Område: det säljaren valt, annars en samlingsplats för lösa adresser.
  const synliga = await synligaOmraden(env, anv);
  let omradeId = txt(body.omrade_id, 40);
  if (!omradeId || !synliga.some((o) => o.id === omradeId)) {
    let ovriga = synliga.find((o) => o.namn === 'Övriga adresser');
    if (!ovriga) {
      ovriga = { id: uid() };
      await kor(env, 'INSERT INTO omraden (id,namn,ort,skapad) VALUES (?1,?2,?3,?4)',
        ovriga.id, 'Övriga adresser', postort, Date.now());
    }
    omradeId = ovriga.id;
  }

  const id = uid();
  await kor(env,
    `INSERT INTO adresser (id,omrade_id,gata,nummer,postort,nyckel,lat,lon,status,skapad)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ejbesokt',?9)`,
    id, omradeId, gata, nummer, postort, nyckel,
    body.lat === undefined ? null : nr(body.lat, null),
    body.lon === undefined ? null : nr(body.lon, null), Date.now());

  const skapad = await en(env, 'SELECT * FROM adresser WHERE id = ?1', id);
  return { adress: putsaAdress(skapad), fanns: false };
};

/**
 * Sparar en omgång dörrar från säljarens anteckningar: varje rad blir en
 * adress (befintlig återanvänds) och, om ett utfall angetts, ett besök.
 * Anteckningarna skrivs efter besöket, så spärren behöver inte bekräftas.
 */
api['anteckningar-importera'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const rader = Array.isArray(body.rader) ? body.rader.slice(0, 100) : [];
  const postort = txt(body.postort, 80);
  const omradeId = txt(body.omrade_id, 40);
  const ut = [];

  for (const r of rader) {
    const gata = txt(r.gata, 120);
    const nummer = txt(r.nummer, 20);
    if (!gata || !nummer) { ut.push({ gata, nummer, fel: 'Gata och husnummer krävs' }); continue; }
    try {
      const { adress, fanns } = await api['adress-ny'](env, request,
        { gata, nummer, postort: txt(r.postort, 80) || postort, omrade_id: omradeId }, anv);

      const resultat = RESULTAT.includes(r.resultat) ? r.resultat : null;
      if (resultat) {
        await api['handelse'](env, request,
          { adress_id: adress.id, resultat, kommentar: txt(r.kommentar, 1000), bekrafta: true }, anv);
      }
      ut.push({ id: adress.id, adress: adress.adress, fanns, resultat });
    } catch (e) {
      ut.push({ gata, nummer, fel: e instanceof Fel ? e.message : 'Kunde inte sparas' });
    }
  }
  return { rader: ut };
};

/**
 * Rättar en adress som blivit fel, t.ex. när hela adressen hamnat i
 * gatunamnet. Historiken följer med dörren, bara texten ändras.
 */
api['adress-andra'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  kraver(anv, 'teamleader');
  const id = txt(body.id, 40);
  const adress = await en(env, 'SELECT * FROM adresser WHERE id = ?1', id);
  if (!adress) throw new Fel('Adressen finns inte', 404);

  const gata = snyggText(txt(body.gata, 120)) || adress.gata;
  const nummer = txt(body.nummer, 20).replace(/\s+/g, ' ').trim() || adress.nummer;
  const postort = body.postort === undefined ? adress.postort : snyggText(txt(body.postort, 80));
  const nyckel = adressnyckel(gata, nummer, postort);

  const krock = await en(env, 'SELECT id FROM adresser WHERE nyckel = ?1 AND id <> ?2', nyckel, id);
  if (krock) throw new Fel('En annan dörr har redan den adressen', 409);

  await kor(env,
    'UPDATE adresser SET gata=?1, nummer=?2, postort=?3, nyckel=?4, lat=?5, lon=?6 WHERE id=?7',
    gata, nummer, postort, nyckel,
    body.lat === undefined ? adress.lat : nr(body.lat, null),
    body.lon === undefined ? adress.lon : nr(body.lon, null), id);

  const uppdaterad = await en(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av WHERE a.id = ?1`, id);
  return { adress: putsaAdress(uppdaterad) };
};

/**
 * Städar adressregistret: slår ihop dörrar som är samma adress skriven på
 * olika sätt ("Vinkel gatan 7" och "Vinkelgatan 7") och rättar VERSALER.
 * Besöken flyttas med, så ingen historik går förlorad.
 *
 * Utan `kor: true` ändras ingenting — då returneras bara vad som skulle hända.
 */
api['adresser-stada'] = async (env, request, body, anv) => {
  kraver(anv, 'admin');
  const rader = await alla(env,
    'SELECT id, gata, nummer, postort, nyckel, skapad, antal_besok FROM adresser ORDER BY skapad LIMIT 5000');

  const grupper = new Map();
  const namnbyten = [];
  for (const a of rader) {
    const gata = snyggText(a.gata);
    const postort = snyggText(a.postort);
    const nyckel = adressnyckel(gata, a.nummer, postort);
    if (gata !== a.gata || postort !== (a.postort || '') || nyckel !== a.nyckel) {
      namnbyten.push({ id: a.id, gata, postort, nyckel, fore: a.gata + ' ' + a.nummer });
    }
    if (!grupper.has(nyckel)) grupper.set(nyckel, []);
    grupper.get(nyckel).push({ ...a, gata, postort });
  }

  const dubbletter = [];
  grupper.forEach((rad) => {
    if (rad.length < 2) return;
    // Den med flest besök behålls, annars den äldsta.
    const sorterad = rad.slice().sort((x, y) => (y.antal_besok || 0) - (x.antal_besok || 0) || x.skapad - y.skapad);
    dubbletter.push({
      behalls: sorterad[0].gata + ' ' + sorterad[0].nummer + (sorterad[0].postort ? ', ' + sorterad[0].postort : ''),
      tas_bort: sorterad.slice(1).map((r) => r.gata + ' ' + r.nummer + (r.postort ? ', ' + r.postort : '')),
      ids: sorterad.map((r) => r.id),
    });
  });

  const sammanfattning = {
    adresser: rader.length,
    stavning: namnbyten.length,
    dubbletter: dubbletter.length,
    exempel: dubbletter.slice(0, 20).map((d) => ({ behalls: d.behalls, tas_bort: d.tas_bort })),
  };
  if (!body.kor) return { forhandsgranskning: true, ...sammanfattning };

  let borttagna = 0;
  for (const d of dubbletter) {
    const [behall, ...bort] = d.ids;
    for (const id of bort) {
      await kor(env, 'UPDATE handelser SET adress_id = ?1 WHERE adress_id = ?2', behall, id);
      await kor(env, 'UPDATE bokningar SET adress_id = ?1 WHERE adress_id = ?2', behall, id);
      // Läge och ort från den som hade uppgiften, om den som behålls saknar den.
      const gammal = await en(env, 'SELECT lat, lon, postort FROM adresser WHERE id = ?1', id);
      if (gammal) {
        await kor(env,
          `UPDATE adresser SET lat = COALESCE(lat, ?1), lon = COALESCE(lon, ?2),
             postort = CASE WHEN postort IS NULL OR postort = '' THEN ?3 ELSE postort END
           WHERE id = ?4`,
          gammal.lat, gammal.lon, gammal.postort, behall);
      }
      await kor(env, 'DELETE FROM adresser WHERE id = ?1', id);
      borttagna++;
    }
    await raknaOmDorr(env, behall);
  }

  // Raderna som slogs ihop är borta; övriga får sin putsade stavning.
  for (const n of namnbyten) {
    await kor(env, 'UPDATE adresser SET gata=?1, postort=?2, nyckel=?3 WHERE id=?4',
      n.gata, n.postort, n.nyckel, n.id);
  }

  return { ...sammanfattning, borttagna, kort: true };
};

/** Räknar om en dörrs status utifrån dess besök, efter en sammanslagning. */
async function raknaOmDorr(env, adressId) {
  const senaste = await en(env,
    'SELECT * FROM handelser WHERE adress_id = ?1 ORDER BY skapad DESC LIMIT 1', adressId);
  const antal = await en(env, 'SELECT COUNT(*) AS n FROM handelser WHERE adress_id = ?1', adressId);
  if (!senaste) {
    await kor(env,
      `UPDATE adresser SET status='ejbesokt', senast_tid=NULL, senast_av=NULL, senast_resultat=NULL,
         sparrad_till=NULL, aterkom_datum=NULL, aterkom_tid=NULL, antal_besok=0 WHERE id=?1`, adressId);
    return;
  }
  const inst = await installningar(env);
  await kor(env,
    `UPDATE adresser SET status=?1, senast_tid=?2, senast_av=?3, senast_resultat=?4,
       sparrad_till=?5, aterkom_datum=?6, aterkom_tid=?7, antal_besok=?8 WHERE id=?9`,
    senaste.resultat, senaste.skapad, senaste.anvandare_id, senaste.resultat,
    sparrTill(senaste.resultat, senaste.aterkom_datum, inst, senaste.skapad),
    senaste.aterkom_datum, senaste.aterkom_tid, (antal && antal.n) || 0, adressId);
}

/** Tar bort en felaktig dörr. Dörrar med historik lämnas kvar. */
api['adress-ta-bort'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  kraver(anv, 'teamleader');
  const id = txt(body.id, 40);
  const adress = await en(env, 'SELECT * FROM adresser WHERE id = ?1', id);
  if (!adress) throw new Fel('Adressen finns inte', 404);

  const besok = await en(env, 'SELECT COUNT(*) AS antal FROM handelser WHERE adress_id = ?1', id);
  if (besok && besok.antal) {
    throw new Fel('Dörren har ' + besok.antal + ' registrerade besök och tas därför inte bort', 409);
  }
  await kor(env, 'DELETE FROM adresser WHERE id = ?1', id);
  return { borttagen: true };
};

/** Dörrar som ska besökas igen — säljarens arbetslista. */
api['aterbesok'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const synliga = (await synligaOmraden(env, anv)).map((o) => o.id);
  if (!synliga.length) return { adresser: [] };
  const p = synliga.map((_, i) => '?' + (i + 1)).join(',');

  const rader = await alla(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     WHERE a.omrade_id IN (${p}) AND a.status IN ('aterkom','ejsvar')
     ORDER BY COALESCE(a.aterkom_datum, '9999-12-31'), a.aterkom_tid
     LIMIT 500`, ...synliga);
  return { adresser: rader.map(putsaAdress) };
};

/** Föreslår nästa dörr: obesökt, i området, nära säljaren och inte spärrad. */
api['nasta-dorr'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const synliga = (await synligaOmraden(env, anv)).map((o) => o.id);
  if (!synliga.length) return { adress: null };
  const omradeId = txt(body.omrade_id, 40);
  const valda = omradeId && synliga.includes(omradeId) ? [omradeId] : synliga;
  const p = valda.map((_, i) => '?' + (i + 1)).join(',');
  const nu = Date.now();

  const kandidater = await alla(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     WHERE a.omrade_id IN (${p}) AND a.sparrad_till <= ${nu}
       AND (a.status = 'ejbesokt' OR (a.status IN ('aterkom','ejsvar') AND a.aterkom_datum <= ?${valda.length + 1}))
     LIMIT 2000`,
    ...valda, new Date(nu).toISOString().slice(0, 10));

  if (!kandidater.length) return { adress: null };

  const lat = nr(body.lat, null), lon = nr(body.lon, null);
  let bast = kandidater[0], bastPoang = Infinity;
  for (const k of kandidater) {
    // Obesökta går före återbesök; därefter avgör avståndet.
    let poang = k.status === 'ejbesokt' ? 0 : 1000;
    if (lat !== null && k.lat && k.lon) {
      poang += Math.hypot((k.lat - lat) * 111, (k.lon - lon) * 55);
    }
    if (poang < bastPoang) { bastPoang = poang; bast = k; }
  }
  return { adress: putsaAdress(bast) };
};

/* ── Bokningar ── */

api['bokningar'] = async (env, request, body, anv) => {
  const villkor = ['1=1'];
  const args = [];
  const lagg = (sql, v) => { args.push(v); villkor.push(sql.replace('?', '?' + args.length)); };
  // Behörigheten först: den går inte att skriva bort med ett filter.
  const grans = await bokningsvillkor(env, anv);
  if (grans.args.length) villkor.push(fyllPlatshallare(grans.sql, grans.args, args));

  if (datum(body.fran)) lagg('b.datum >= ?', body.fran);
  if (datum(body.till)) lagg('b.datum <= ?', body.till);
  if (txt(body.bokare_id, 40)) lagg('b.anvandare_id = ?', txt(body.bokare_id, 40));
  if (txt(body.saljare_id, 40)) lagg('b.saljare_id = ?', txt(body.saljare_id, 40));
  if (txt(body.status, 20)) lagg('b.status = ?', txt(body.status, 20));
  if (txt(body.omrade_id, 40)) lagg('ad.omrade_id = ?', txt(body.omrade_id, 40));

  const rader = await alla(env,
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare, ad.gata, ad.nummer, ad.omrade_id, o.namn AS omrade
     FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id
     LEFT JOIN omraden o ON o.id = ad.omrade_id
     WHERE ${villkor.join(' AND ')}
     ORDER BY b.datum, b.tid LIMIT 1000`, ...args);

  return {
    bokningar: rader.map((b) => ({
      ...b,
      adress: b.gata ? b.gata + ' ' + b.nummer : '',
      kund: [b.fornamn, b.efternamn].filter(Boolean).join(' '),
    })),
  };
};

/**
 * Kalendern: bokningarna i ett datumintervall plus rutornas inställningar,
 * så att appen ritar samma rutnät som servern godkänner.
 */
api['kalender'] = async (env, request, body, anv) => {
  const fran = datum(body.fran) || datum(body.datum);
  const till = datum(body.till) || fran;
  if (!fran) throw new Fel('Datum krävs');

  const rader = await alla(env,
    `SELECT b.id, b.datum, b.tid, b.fornamn, b.efternamn, b.telefon, b.kommentar, b.status,
            b.anvandare_id, b.saljare_id, u.namn AS bokare, sa.namn AS saljare,
            ad.gata, ad.nummer, ad.postort
     FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id
     WHERE b.datum >= ?1 AND b.datum <= ?2 AND b.status <> 'avbokad'
     ORDER BY b.datum, b.tid LIMIT 2000`, fran, till);

  const perDag = {};
  rader.forEach((b) => { perDag[b.datum] = (perDag[b.datum] || 0) + 1; });

  const saljare = await saljarlista(env);

  // Säljarnas öppna tider — bara för korta intervall, alltså dagsvyn.
  // Månadsvyn behöver dem inte och skulle bli tolv gånger så tung.
  const tider = {};
  const dagar = dagarMellan(fran, till);
  if (dagar.length <= 8) {
    for (const d of dagar) {
      tider[d] = {};
      for (const sa of saljare) tider[d][sa.id] = await tiderForSaljare(env, sa.id, d);
      if (!saljare.length) tider[d][''] = await tiderForSaljare(env, null, d);
    }
  }

  // Vem som får se kundens uppgifter: den som bokade, säljaren mötet ligger
  // på, och de som ska se allt. För övriga är rutan bara upptagen.
  const oppen = (b) => far(anv, 'allt_bokat') || b.anvandare_id === anv.id || b.saljare_id === anv.id;

  return {
    installningar: {
      oppnar: KALENDER.OPPNAR, sista: KALENDER.SISTA,
      slot: KALENDER.SLOT, dagar: KALENDER.DAGAR,
    },
    slottar: slottar(),
    saljare,
    tider,
    per_dag: perDag,
    bokningar: rader.map((b) => (oppen(b) ? {
      ...b,
      adress: b.gata ? b.gata + ' ' + b.nummer : '',
      kund: [b.fornamn, b.efternamn].filter(Boolean).join(' '),
      min: true,
    } : {
      id: b.id, datum: b.datum, tid: b.tid, status: b.status,
      saljare_id: b.saljare_id, saljare: b.saljare, bokare: b.bokare,
      anvandare_id: b.anvandare_id, adress: '', kund: '', min: false,
    })),
  };
};

/** Datumen i ett intervall, som text. Tomt om intervallet är orimligt långt. */
function dagarMellan(fran, till) {
  const ut = [];
  const d = new Date(fran + 'T12:00:00Z');
  const slut = new Date(till + 'T12:00:00Z');
  while (d <= slut && ut.length < 40) {
    ut.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return ut;
}

/**
 * Bokar en ruta i kalendern. Adressen skapas eller återanvänds som vanligt,
 * så att bokningen också syns som en dörr på kartan.
 */
api['kalender-boka'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'boka');
  const dat = datum(body.datum);
  const tid = klockslag(body.tid);
  kontrolleraSlot(dat, tid);

  const fornamn = txt(body.fornamn, 80);
  const telefon = txt(body.telefon, 40);
  if (!fornamn || !telefon) throw new Fel('Kundens namn och telefonnummer krävs');

  // Säljaren mötet ska ligga på, och att han är ledig då.
  const saljare = await valjSaljare(env, body.saljare_id);
  if (saljare && !(await tidOppen(env, saljare, dat, tid))) throw new Fel(TIDEN_STANGD, 409);
  if (!(await slotLedig(env, dat, tid, saljare))) throw new Fel(TIDEN_TAGEN, 409);

  // Mötesbokaren bokningen tillhör: den som bokar, eller den en Mötesbokare+
  // väljer åt någon annan.
  let bokareId = anv.id;
  const vald = txt(body.bokare_id, 40);
  if (vald && vald !== anv.id) {
    kraverFormaga(anv, 'allt_bokat');
    if (await en(env, 'SELECT id FROM anvandare WHERE id = ?1', vald)) bokareId = vald;
  }

  let adressId = txt(body.adress_id, 40);
  if (!adressId) {
    const delad = body.gata ? { gata: txt(body.gata, 120), nummer: txt(body.nummer, 20) }
      : delaAdressrad(txt(body.adress, 200));
    if (!delad.gata || !delad.nummer) throw new Fel('Adress med husnummer krävs');
    const svar = await api['adress-ny'](env, request, {
      gata: delad.gata, nummer: delad.nummer,
      postort: txt(body.postort, 80) || delad.postort,
      omrade_id: txt(body.omrade_id, 40),
    }, anv);
    adressId = svar.adress.id;
  }

  // Bokningen registreras som ett dörrbesök: då får huset status BOKAD på
  // kartan, besöket hamnar i historiken och siffrorna stämmer — oavsett om
  // bokningen gjordes vid dörren eller i kalendern.
  const svar = await api['handelse'](env, request, {
    adress_id: adressId,
    resultat: 'bokat',
    fornamn,
    efternamn: txt(body.efternamn, 80),
    telefon,
    datum: dat,
    tid,
    saljare_id: saljare,
    kommentar: txt(body.kommentar, 1000),
    bekrafta: true,
  }, { ...anv, id: bokareId });

  const bokning = await en(env,
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare, ad.gata, ad.nummer FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id WHERE b.id = ?1`, svar.bokning.id);
  return { bokning: { ...bokning, adress: bokning.gata ? bokning.gata + ' ' + bokning.nummer : '' } };
};

/** "Törngatan 16, Örebro" → gata, nummer och ort var för sig. */
function delaAdressrad(rad) {
  const delar = String(rad || '').split(',').map((d) => d.trim()).filter(Boolean);
  const m = (delar[0] || '').match(/^(.*[^\d\s])\s+(\d+\s*[a-zA-ZåäöÅÄÖ]?)$/);
  return {
    gata: m ? m[1].trim() : '',
    nummer: m ? m[2].replace(/\s+/g, '') : '',
    postort: delar.slice(1).join(' ').replace(/\b\d{3}\s?\d{2}\b/g, '').trim(),
  };
};

/**
 * Ändrar en bokning: kunduppgifter, kommentar och vid behov tid.
 * Flyttas den till en ny ruta gäller samma regler som vid nybokning.
 */
api['bokning-andra'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  const bokning = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', id);
  if (!bokning) throw new Fel('Bokningen finns inte', 404);
  // Den som bokade får ändra sin bokning; annars krävs hela överblicken.
  if (bokning.anvandare_id !== anv.id) kraverFormaga(anv, 'allt_bokat');

  const dat = body.datum === undefined ? bokning.datum : datum(body.datum);
  const tid = body.tid === undefined ? bokning.tid : klockslag(body.tid);
  const saljare = body.saljare_id === undefined
    ? bokning.saljare_id : await valjSaljare(env, body.saljare_id);
  const flyttad = dat !== bokning.datum || tid !== bokning.tid || saljare !== bokning.saljare_id;
  if (flyttad && dat && tid) {
    kontrolleraSlot(dat, tid);
    if (saljare && !(await tidOppen(env, saljare, dat, tid))) throw new Fel(TIDEN_STANGD, 409);
    if (!(await slotLedig(env, dat, tid, saljare, id))) throw new Fel(TIDEN_TAGEN, 409);
  }

  try {
    await kor(env,
      `UPDATE bokningar SET fornamn=?1, efternamn=?2, telefon=?3, datum=?4, tid=?5, kommentar=?6,
         saljare_id=?7
       WHERE id=?8`,
      body.fornamn === undefined ? bokning.fornamn : txt(body.fornamn, 80),
      body.efternamn === undefined ? bokning.efternamn : txt(body.efternamn, 80),
      body.telefon === undefined ? bokning.telefon : txt(body.telefon, 40),
      dat, tid,
      body.kommentar === undefined ? bokning.kommentar : txt(body.kommentar, 1000),
      saljare, id);
  } catch (e) {
    if (arKrock(e)) throw new Fel(TIDEN_TAGEN, 409);
    throw e;
  }

  const uppdaterad = await en(env,
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare, ad.gata, ad.nummer FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id WHERE b.id = ?1`, id);
  if (flyttad) {
    await nyhet(env, 'andring',
      anv.namn + ' flyttade mötet på ' + kortAdress(uppdaterad) + ' till ' +
      (dat || '(inget datum)') + (tid ? ' kl. ' + tid : ''),
      { bokning_id: id, saljare_id: saljare, anvandare_id: anv.id });
  }
  return { bokning: { ...uppdaterad, adress: uppdaterad.gata ? uppdaterad.gata + ' ' + uppdaterad.nummer : '' } };
};

/**
 * Alla bokade adresser med allt som hör till dem: kund, hus, säljare,
 * kommentarer och bilder. Sidan är gemensam — vem som helst som är inloggad
 * ser alla bokningar, inklusive besiktaren som ska ut till kunden.
 */
api['bokade-adresser'] = async (env, request, body, anv) => {
  const villkor = ["b.status <> 'avbokad'"];
  const args = [];
  const lagg = (sql, v) => { args.push(v); villkor.push(sql.replace('?', '?' + args.length)); };

  const grans = await bokningsvillkor(env, anv);
  if (grans.args.length) villkor.push(fyllPlatshallare(grans.sql, grans.args, args));
  if (datum(body.fran)) lagg('b.datum >= ?', body.fran);
  if (datum(body.till)) lagg('b.datum <= ?', body.till);
  if (txt(body.status, 20)) lagg('b.status = ?', txt(body.status, 20));

  const rader = await alla(env,
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare, ad.gata, ad.nummer, ad.postort, ad.lat, ad.lon,
            ad.status AS husstatus, o.namn AS omrade
     FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id
     LEFT JOIN omraden o ON o.id = ad.omrade_id
     WHERE ${villkor.join(' AND ')}
     ORDER BY b.datum DESC, b.tid DESC LIMIT 500`, ...args);
  if (!rader.length) return { bokningar: [] };

  const idn = rader.map((b) => b.id);
  const p = idn.map((_, i) => '?' + (i + 1)).join(',');
  const kommentarer = await alla(env,
    `SELECT k.*, u.namn AS forfattare, u.roll FROM kommentarer k
     LEFT JOIN anvandare u ON u.id = k.anvandare_id
     WHERE k.bokning_id IN (${p}) ORDER BY k.skapad`, ...idn);
  // Bilddatan hämtas för sig — annars blir svaret enormt.
  const bilagor = await alla(env,
    `SELECT id, bokning_id, namn, typ, storlek, skapad FROM bilagor
     WHERE bokning_id IN (${p}) ORDER BY skapad`, ...idn);

  // Återkopplingen följer med bokningen: den som ser bokningen ser vad mötet
  // gav. Den som inte får se bokningen kommer aldrig hit.
  const aterkoppling = await alla(env,
    `SELECT a.*, u.namn AS forfattare FROM aterkoppling a
     LEFT JOIN anvandare u ON u.id = a.anvandare_id
     WHERE a.bokning_id IN (${p}) ORDER BY a.skapad`, ...idn);

  return {
    utfall: UTFALLSTEXT,
    far_aterkoppla: far(anv, 'aterkoppla'),
    bokningar: rader.map((b) => ({
      ...b,
      adress: b.gata ? b.gata + ' ' + b.nummer : '',
      kund: [b.fornamn, b.efternamn].filter(Boolean).join(' '),
      kommentarer: kommentarer.filter((k) => k.bokning_id === b.id),
      bilagor: bilagor.filter((f) => f.bokning_id === b.id),
      aterkoppling: aterkoppling.filter((a) => a.bokning_id === b.id)
        .map((a) => ({ ...a, utfall_text: UTFALLSTEXT[a.utfall] || a.utfall })),
    })),
  };
};

/** Skriver en kommentar på en bokning. Alla inloggade får kommentera. */
api['bokning-kommentar'] = async (env, request, body, anv) => {
  const bokningId = txt(body.bokning_id, 40);
  const text = txt(body.text, 2000);
  if (!bokningId || !text) throw new Fel('Bokning och text krävs');
  const bok = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', bokningId);
  if (!bok) throw new Fel('Bokningen finns inte', 404);
  await kraverBokning(env, anv, bok);
  const id = uid();
  await kor(env, 'INSERT INTO kommentarer (id,bokning_id,anvandare_id,text,skapad) VALUES (?1,?2,?3,?4,?5)',
    id, bokningId, anv.id, text, Date.now());
  return { kommentar: { id, bokning_id: bokningId, text, forfattare: anv.namn, skapad: Date.now() } };
};

api['bokning-kommentar-ta-bort'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  const k = await en(env, 'SELECT * FROM kommentarer WHERE id = ?1', id);
  if (!k) throw new Fel('Kommentaren finns inte', 404);
  if (k.anvandare_id !== anv.id) kraverFormaga(anv, 'allt_bokat');
  await kor(env, 'DELETE FROM kommentarer WHERE id = ?1', id);
  return {};
};

/* Bilderna skalas ner i appen; det här är taket för en enskild bild. */
const MAX_BILD = 900000;

/** Lägger en bild från telefonen på en bokning. */
api['bokning-bilaga'] = async (env, request, body, anv) => {
  const bokningId = txt(body.bokning_id, 40);
  const data = typeof body.data === 'string' ? body.data : '';
  if (!bokningId || !data.startsWith('data:image/')) throw new Fel('Bokning och bild krävs');
  if (data.length > MAX_BILD) throw new Fel('Bilden är för stor även nedskalad — försök med en annan');
  const bok = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', bokningId);
  if (!bok) throw new Fel('Bokningen finns inte', 404);
  await kraverBokning(env, anv, bok);
  const antal = await en(env, 'SELECT COUNT(*) AS n FROM bilagor WHERE bokning_id = ?1', bokningId);
  if (antal && antal.n >= 20) throw new Fel('Max 20 bilder per bokning');

  const id = uid();
  await kor(env,
    'INSERT INTO bilagor (id,bokning_id,anvandare_id,namn,typ,storlek,data,skapad) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)',
    id, bokningId, anv.id, txt(body.namn, 120), txt(body.typ, 40), data.length, data, Date.now());
  return { bilaga: { id, bokning_id: bokningId, namn: txt(body.namn, 120), storlek: data.length } };
};

/** Hämtar en bilds data. Ligger för sig så att listan kan vara lätt. */
api['bilaga'] = async (env, request, body, anv) => {
  const bilaga = await en(env, 'SELECT * FROM bilagor WHERE id = ?1', txt(body.id, 40));
  if (!bilaga) throw new Fel('Bilden finns inte', 404);
  const bok = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', bilaga.bokning_id);
  if (bok) await kraverBokning(env, anv, bok);
  return { bilaga };
};

api['bilaga-ta-bort'] = async (env, request, body, anv) => {
  const bilaga = await en(env, 'SELECT id, anvandare_id FROM bilagor WHERE id = ?1', txt(body.id, 40));
  if (!bilaga) throw new Fel('Bilden finns inte', 404);
  if (bilaga.anvandare_id !== anv.id) kraverFormaga(anv, 'allt_bokat');
  await kor(env, 'DELETE FROM bilagor WHERE id = ?1', bilaga.id);
  return {};
};

api['bokning-status'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  const status = ['bokad', 'genomford', 'avbokad'].includes(body.status) ? body.status : null;
  if (!id || !status) throw new Fel('Bokning och status krävs');
  const bokning = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', id);
  if (!bokning) throw new Fel('Bokningen finns inte', 404);
  // Besiktaren är den som varit på plats och vet om mötet blev av — men han
  // får bara bocka av det, inte avboka andras möten.
  await kraverBokning(env, anv, bokning);
  if (arBesiktare(anv)) {
    if (status !== 'genomford') throw new Fel('Säljaren kan bara markera mötet som genomfört', 403);
  } else if (bokning.anvandare_id !== anv.id) {
    kraverFormaga(anv, 'allt_bokat');
  }
  await kor(env, 'UPDATE bokningar SET status = ?1 WHERE id = ?2', status, id);

  const rad = await en(env,
    `SELECT b.*, ad.gata, ad.nummer FROM bokningar b
     LEFT JOIN adresser ad ON ad.id = b.adress_id WHERE b.id = ?1`, id);
  const ord = { bokad: 'öppnade', genomford: 'markerade som genomfört', avbokad: 'avbokade' };
  await nyhet(env, status === 'avbokad' ? 'avbokning' : 'andring',
    anv.namn + ' ' + ord[status] + ' mötet på ' + kortAdress(rad),
    { bokning_id: id, saljare_id: bokning.saljare_id, anvandare_id: anv.id });
  return {};
};

/* ── Säljarnas tider ── */

/**
 * Säljarnas lediga tider i ett datumintervall, och vem varje tid tillhör.
 * Alla får se dem: mötesbokaren behöver dem för att kunna boka, säljaren för
 * att se sin egen dag, Admin Säljare för att styra dem.
 */
api['saljartider'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'se_tider');
  const fran = datum(body.fran) || datum(body.datum);
  const till = datum(body.till) || fran;
  if (!fran) throw new Fel('Datum krävs');

  const saljare = await saljarlista(env);
  const dagar = dagarMellan(fran, till);
  const tider = {};
  const bokat = {};

  const bokningar = await alla(env,
    `SELECT datum, tid, saljare_id FROM bokningar
     WHERE datum >= ?1 AND datum <= ?2 AND status <> 'avbokad' AND tid IS NOT NULL AND tid <> ''`,
    fran, till);

  for (const d of dagar) {
    tider[d] = {};
    bokat[d] = {};
    for (const sa of saljare) {
      tider[d][sa.id] = await tiderForSaljare(env, sa.id, d);
      bokat[d][sa.id] = bokningar
        .filter((b) => b.datum === d && b.saljare_id === sa.id).map((b) => b.tid);
    }
  }

  return {
    saljare,
    slottar: slottar(),
    dagar,
    tider,
    bokat,
    far_styra: far(anv, 'styr_tider'),
    eget_schema: far(anv, 'eget_schema') ? anv.id : null,
  };
};

/**
 * Sätter en säljares tider för en dag. Skickas hela dagen på en gång, så att
 * "de här tiderna jobbar jag" är en handling och inte en rad i taget.
 *
 * Säljaren får styra sin egen dag, Admin Säljare och Mötesbokare+ allas.
 * Skickas listan tom betyder det att säljaren inte är tillgänglig alls den
 * dagen; skickas den som null tas raderna bort och standarddagen gäller igen.
 */
api['saljartider-spara'] = async (env, request, body, anv) => {
  const dat = datum(body.datum);
  if (!dat) throw new Fel('Datum krävs');
  const saljareId = txt(body.saljare_id, 40) || anv.id;

  if (saljareId !== anv.id || !far(anv, 'eget_schema')) kraverFormaga(anv, 'styr_tider');
  const saljare = await en(env,
    "SELECT id, namn FROM anvandare WHERE id = ?1 AND roll = 'besiktare' AND aktiv = 1", saljareId);
  if (!saljare) throw new Fel('Okänd säljare');

  const giltiga = slottar();
  const nya = body.tider === null || body.tider === undefined
    ? null
    : [...new Set((Array.isArray(body.tider) ? body.tider : [])
        .map((t) => klockslag(t)).filter((t) => t && giltiga.includes(t)))].sort();

  // Tider som redan har ett möte kan inte tas bort — mötet står kvar och
  // skulle bli osynligt i kalendern.
  const bokade = (await alla(env,
    `SELECT tid FROM bokningar WHERE saljare_id = ?1 AND datum = ?2 AND status <> 'avbokad'
       AND tid IS NOT NULL AND tid <> ''`, saljareId, dat)).map((b) => b.tid);
  if (nya) {
    const tappade = bokade.filter((t) => !nya.includes(t));
    if (tappade.length) {
      throw new Fel('Tiden ' + tappade.join(', ') + ' har ett bokat möte — flytta det först', 409);
    }
  }

  await kor(env, 'DELETE FROM saljartider WHERE saljare_id = ?1 AND datum = ?2', saljareId, dat);
  if (nya) {
    const nu = Date.now();
    for (const t of nya) {
      await kor(env,
        'INSERT INTO saljartider (id,saljare_id,datum,tid,ledig,satt_av,skapad) VALUES (?1,?2,?3,?4,1,?5,?6)',
        uid(), saljareId, dat, t, anv.id, nu);
    }
  }

  await nyhet(env, 'tid',
    anv.namn + (saljareId === anv.id ? ' ändrade sina tider ' : ' ändrade ' + saljare.namn + 's tider ') +
    dat + ' — ' + (nya === null ? 'standarddagen gäller' : nya.length ? nya.join(', ') : 'ingen tid alls'),
    { saljare_id: saljareId, anvandare_id: anv.id });

  return { datum: dat, saljare_id: saljareId, tider: await tiderForSaljare(env, saljareId, dat) };
};

/* ── Återkoppling på ett möte ── */

const UTFALL = ['salt', 'ej_salt', 'uppfoljning', 'uteblev'];
const UTFALLSTEXT = {
  salt: 'Sålt', ej_salt: 'Inte sålt', uppfoljning: 'Uppföljning', uteblev: 'Kunden uteblev',
};

/**
 * Säljaren skriver hur mötet gick. Återkopplingen hör till bokningen, så den
 * som bokade får se vad hans bokning ledde till.
 */
api['aterkoppling-spara'] = async (env, request, body, anv) => {
  const bokningId = txt(body.bokning_id, 40);
  const utfall = UTFALL.includes(body.utfall) ? body.utfall : null;
  if (!bokningId || !utfall) throw new Fel('Bokning och utfall krävs');

  const bokning = await en(env,
    `SELECT b.*, ad.gata, ad.nummer FROM bokningar b
     LEFT JOIN adresser ad ON ad.id = b.adress_id WHERE b.id = ?1`, bokningId);
  if (!bokning) throw new Fel('Bokningen finns inte', 404);

  // Den som körde mötet återkopplar. Teamledare och admin får rätta.
  const min = bokning.saljare_id === anv.id ||
    (arBesiktare(anv) && !bokning.saljare_id && (await saljarlista(env)).length === 1);
  if (!min) kraver(anv, 'teamleader');
  if (!far(anv, 'aterkoppla')) kraver(anv, 'teamleader');

  const id = uid();
  const nu = Date.now();
  await kor(env,
    `INSERT INTO aterkoppling (id,bokning_id,anvandare_id,utfall,belopp,text,skapad)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`,
    id, bokningId, anv.id, utfall,
    body.belopp === undefined || body.belopp === '' ? null : Math.round(nr(body.belopp, 0)),
    txt(body.text, 2000), nu);

  // Mötet är kört, alltså är det genomfört.
  if (bokning.status === 'bokad') {
    await kor(env, "UPDATE bokningar SET status = 'genomford' WHERE id = ?1", bokningId);
  }

  await nyhet(env, 'aterkoppling',
    anv.namn + ' återkopplade på ' + kortAdress(bokning) + ': ' + UTFALLSTEXT[utfall],
    { bokning_id: bokningId, saljare_id: bokning.saljare_id || anv.id, anvandare_id: anv.id });

  return { aterkoppling: { id, bokning_id: bokningId, utfall, text: txt(body.text, 2000),
    forfattare: anv.namn, skapad: nu } };
};

/**
 * Återkopplingen någon får se: säljaren sin egen, mötesbokaren den som hör
 * till hans bokningar, Mötesbokare+ och Admin Säljare all.
 */
api['aterkoppling'] = async (env, request, body, anv) => {
  const villkor = ['1=1'];
  const args = [];
  const lagg = (sql, v) => { args.push(v); villkor.push(sql.replace('?', '?' + args.length)); };

  if (!far(anv, 'all_aterkoppling')) {
    if (arBesiktare(anv)) lagg('a.anvandare_id = ?', anv.id);
    else lagg('b.anvandare_id = ?', anv.id);
  }
  if (txt(body.bokning_id, 40)) lagg('a.bokning_id = ?', txt(body.bokning_id, 40));
  if (datum(body.fran)) lagg('b.datum >= ?', body.fran);
  if (datum(body.till)) lagg('b.datum <= ?', body.till);

  const rader = await alla(env,
    `SELECT a.*, u.namn AS forfattare, b.datum, b.tid, b.fornamn, b.efternamn,
            b.anvandare_id AS bokare_id, ub.namn AS bokare, ad.gata, ad.nummer
     FROM aterkoppling a
     JOIN bokningar b ON b.id = a.bokning_id
     LEFT JOIN anvandare u ON u.id = a.anvandare_id
     LEFT JOIN anvandare ub ON ub.id = b.anvandare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id
     WHERE ${villkor.join(' AND ')}
     ORDER BY a.skapad DESC LIMIT 300`, ...args);

  return {
    utfall: UTFALLSTEXT,
    aterkoppling: rader.map((a) => ({
      ...a,
      adress: a.gata ? a.gata + ' ' + a.nummer : '',
      kund: [a.fornamn, a.efternamn].filter(Boolean).join(' '),
      utfall_text: UTFALLSTEXT[a.utfall] || a.utfall,
    })),
  };
};

/* ── Nyhetsflöde ── */

/**
 * Flödet, beskuret efter roll:
 *
 *   Mötesbokare+, teamleader, admin   allt
 *   Admin Säljare                     det som rör en säljare
 *   Mötesbokare                       det han själv gjort, och det som hänt
 *                                     med hans bokningar
 *   Säljare                           det som rör honom
 */
api['nyheter'] = async (env, request, body, anv) => {
  const villkor = ['1=1'];
  const args = [];
  const lagg = (sql, ...v) => villkor.push(fyllPlatshallare(sql, v, args));

  if (far(anv, 'allt_bokat') && far(anv, 'skapa_bokare')) {
    // Mötesbokare+ och uppåt ser hela flödet.
  } else if (far(anv, 'styr_tider')) {
    lagg('n.saljare_id IS NOT NULL');
  } else if (arBesiktare(anv)) {
    lagg('(n.saljare_id = ? OR n.anvandare_id = ?)', anv.id, anv.id);
  } else {
    lagg(`(n.anvandare_id = ? OR n.bokning_id IN
           (SELECT id FROM bokningar WHERE anvandare_id = ?))`, anv.id, anv.id);
  }

  const rader = await alla(env,
    `SELECT n.*, u.namn AS av FROM nyheter n
     LEFT JOIN anvandare u ON u.id = n.anvandare_id
     WHERE ${villkor.join(' AND ')}
     ORDER BY n.skapad DESC LIMIT ?${args.length + 1}`,
    ...args, Math.min(200, Math.max(1, nr(body.antal, 60))));

  return { nyheter: rader };
};

/* ── Puls: har något ändrats? ── */

/**
 * Ett litet anrop appen kan ställa ofta. Svarar med tidpunkten för det
 * senaste som hänt — ändras den vet appen att den ska hämta om, och slipper
 * hämta hela kalendern var tjugonde sekund.
 */
api['puls'] = async (env, request, body, anv) => {
  const rad = await en(env,
    `SELECT MAX(t) AS senast FROM (
       SELECT MAX(skapad) AS t FROM nyheter
       UNION ALL SELECT MAX(skapad) FROM bokningar
       UNION ALL SELECT MAX(skapad) FROM saljartider
       UNION ALL SELECT MAX(skapad) FROM aterkoppling
       UNION ALL SELECT MAX(skapad) FROM kommentarer
     )`);
  return { senast: nr(rad && rad.senast, 0), tid: Date.now() };
};

/* ── Position ── */

api['position'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const lat = nr(body.lat, null), lon = nr(body.lon, null);
  if (lat === null || lon === null) throw new Fel('Position saknas');
  await kor(env,
    `INSERT INTO positioner (anvandare_id,lat,lon,uppdaterad) VALUES (?1,?2,?3,?4)
     ON CONFLICT(anvandare_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, uppdaterad=excluded.uppdaterad`,
    anv.id, lat, lon, Date.now());
  return {};
};

api['positioner'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  kraver(anv, 'teamleader');
  const sedan = Date.now() - 30 * 60000;
  const rader = await alla(env,
    `SELECT p.*, u.namn, u.roll FROM positioner p
     JOIN anvandare u ON u.id = p.anvandare_id
     WHERE p.uppdaterad > ?1 ORDER BY u.namn`, sedan);
  return { positioner: rader };
};

/* ── Dashboard och statistik ── */

function period(body) {
  const idag = new Date().toISOString().slice(0, 10);
  const fran = datum(body.fran) || idag;
  const till = datum(body.till) || idag;
  return {
    fran,
    till,
    franMs: new Date(fran + 'T00:00:00Z').getTime(),
    tillMs: new Date(till + 'T23:59:59Z').getTime(),
  };
}

function hitrate(rad, namnare) {
  const bas = namnare === 'oppnade' ? rad.oppnade : namnare === 'positiva' ? rad.positiva : rad.dorrar;
  return bas ? Math.round((rad.bokade / bas) * 1000) / 10 : 0;
}

api['dashboard'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const { fran, till, franMs, tillMs } = period(body);
  const inst = await installningar(env);
  const namnare = inst.hitrate_namnare || 'alla';
  const omradeFilter = txt(body.omrade_id, 40);

  const villkor = omradeFilter ? 'AND ad.omrade_id = ?3' : '';
  const args = omradeFilter ? [franMs, tillMs, omradeFilter] : [franMs, tillMs];

  const raknare = `
      COUNT(*) AS dorrar,
      COUNT(DISTINCT h.adress_id) AS unika,
      SUM(h.oppnade) AS oppnade,
      SUM(h.positiv) AS positiva,
      SUM(CASE WHEN h.resultat = 'bokat' THEN 1 ELSE 0 END) AS bokade,
      SUM(CASE WHEN h.resultat = 'nej' THEN 1 ELSE 0 END) AS nej,
      SUM(CASE WHEN h.resultat = 'ejsvar' THEN 1 ELSE 0 END) AS ejsvar,
      SUM(CASE WHEN h.resultat = 'aterkom' THEN 1 ELSE 0 END) AS aterkom`;

  const total = await en(env,
    `SELECT ${raknare} FROM handelser h
     JOIN adresser ad ON ad.id = h.adress_id
     WHERE h.skapad BETWEEN ?1 AND ?2 ${villkor}`, ...args) || {};

  const perSaljare = await alla(env,
    `SELECT h.anvandare_id, u.namn, ${raknare} FROM handelser h
     JOIN adresser ad ON ad.id = h.adress_id
     LEFT JOIN anvandare u ON u.id = h.anvandare_id
     WHERE h.skapad BETWEEN ?1 AND ?2 ${villkor}
     GROUP BY h.anvandare_id ORDER BY bokade DESC`, ...args);

  const perOmrade = await alla(env,
    `SELECT ad.omrade_id, o.namn, ${raknare} FROM handelser h
     JOIN adresser ad ON ad.id = h.adress_id
     LEFT JOIN omraden o ON o.id = ad.omrade_id
     WHERE h.skapad BETWEEN ?1 AND ?2 ${villkor}
     GROUP BY ad.omrade_id ORDER BY bokade DESC`, ...args);

  const genomforda = await en(env,
    `SELECT COUNT(*) AS antal FROM bokningar WHERE status = 'genomford' AND datum BETWEEN ?1 AND ?2`,
    fran, till);

  const genomfordaPer = await alla(env,
    `SELECT anvandare_id, COUNT(*) AS antal FROM bokningar
     WHERE status = 'genomford' AND datum BETWEEN ?1 AND ?2 GROUP BY anvandare_id`, fran, till);
  const genomfordaKarta = {};
  for (const g of genomfordaPer) genomfordaKarta[g.anvandare_id] = nr(g.antal);

  const aktiva = await en(env,
    'SELECT COUNT(DISTINCT anvandare_id) AS antal FROM handelser WHERE skapad BETWEEN ?1 AND ?2',
    franMs, tillMs);

  const siffror = (r) => ({
    dorrar: nr(r.dorrar), unika: nr(r.unika), oppnade: nr(r.oppnade), positiva: nr(r.positiva),
    bokade: nr(r.bokade), nej: nr(r.nej), ejsvar: nr(r.ejsvar), aterkom: nr(r.aterkom),
  });

  const totalt = siffror(total);
  const leaderboard = perSaljare
    .filter((r) => r.anvandare_id)
    .map((r) => {
      const s = siffror(r);
      return {
        id: r.anvandare_id,
        namn: r.namn || 'Okänd',
        ...s,
        genomforda: genomfordaKarta[r.anvandare_id] || 0,
        hitrate: hitrate(s, namnare),
      };
    });

  return {
    period: { fran, till },
    namnare,
    kpi: {
      ...totalt,
      hitrate: hitrate(totalt, namnare),
      genomforda: nr(genomforda && genomforda.antal),
      aktiva_saljare: nr(aktiva && aktiva.antal),
    },
    funnel: {
      dorrar: totalt.dorrar,
      oppnade: totalt.oppnade,
      positiva: totalt.positiva,
      bokade: totalt.bokade,
      genomforda: nr(genomforda && genomforda.antal),
    },
    leaderboard,
    omraden: perOmrade.filter((r) => r.omrade_id).map((r) => {
      const s = siffror(r);
      return { id: r.omrade_id, namn: r.namn || 'Okänt', ...s, hitrate: hitrate(s, namnare) };
    }),
    mal: {
      dorrar: nr(inst.mal_dorrar, 0),
      bokningar: nr(inst.mal_bokningar, 0),
      hitrate: nr(inst.mal_hitrate, 0),
    },
  };
};

/** Enskild säljares utveckling vecka för vecka. */
api['saljare-trend'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const id = txt(body.id, 40) || anv.id;
  if (id !== anv.id) kraver(anv, 'teamleader');
  const veckor = Math.min(Math.max(nr(body.veckor, 6), 1), 26);
  const start = Date.now() - veckor * 7 * DAG;
  const inst = await installningar(env);

  const rader = await alla(env,
    `SELECT strftime('%Y-%W', skapad/1000, 'unixepoch') AS vecka,
            COUNT(*) AS dorrar, SUM(oppnade) AS oppnade, SUM(positiv) AS positiva,
            SUM(CASE WHEN resultat = 'bokat' THEN 1 ELSE 0 END) AS bokade
     FROM handelser WHERE anvandare_id = ?1 AND skapad >= ?2
     GROUP BY vecka ORDER BY vecka`, id, start);

  return {
    trend: rader.map((r) => ({
      vecka: r.vecka,
      dorrar: nr(r.dorrar),
      bokade: nr(r.bokade),
      hitrate: hitrate({ dorrar: nr(r.dorrar), oppnade: nr(r.oppnade), positiva: nr(r.positiva), bokade: nr(r.bokade) },
        inst.hitrate_namnare || 'alla'),
    })),
  };
};

api['installningar-spara'] = async (env, request, body, anv) => {
  kraver(anv, 'admin');
  const tillatna = ['sparr_nej', 'sparr_ejsvar', 'sparr_bokat', 'sparr_aterkom', 'nyligen_dagar',
    'hitrate_namnare', 'mal_dorrar', 'mal_bokningar', 'mal_hitrate'];
  for (const [k, v] of Object.entries(body.installningar || {})) {
    if (!tillatna.includes(k)) continue;
    await kor(env, `INSERT INTO installningar (nyckel,varde) VALUES (?1,?2)
                    ON CONFLICT(nyckel) DO UPDATE SET varde = excluded.varde`, k, String(v).slice(0, 40));
  }
  return { installningar: await installningar(env) };
};

/**
 * Skapar den allra första administratören. Fungerar bara så länge det inte
 * finns någon användare, och kräver installationsnyckeln från wrangler.
 */
api['installera'] = async (env, request, body) => {
  if (!env.INSTALL_NYCKEL) throw new Fel('Servern saknar INSTALL_NYCKEL', 500);
  if (!lika(String(body.nyckel || ''), env.INSTALL_NYCKEL)) throw new Fel('Fel installationsnyckel', 401);

  const finns = await en(env, 'SELECT COUNT(*) AS antal FROM anvandare');
  if (nr(finns && finns.antal) > 0) throw new Fel('Systemet är redan installerat', 409);

  const namn = txt(body.namn, 80) || 'Administratör';
  const epost = (txt(body.epost, 160) || '').toLowerCase();
  const losenord = String(body.losenord || '');
  if (!epost || losenord.length < 8) throw new Fel('E-post och lösenord på minst 8 tecken krävs');

  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const id = uid();
  await kor(env,
    'INSERT INTO anvandare (id,namn,epost,roll,hash,salt,aktiv,skapad) VALUES (?1,?2,?3,?4,?5,?6,1,?7)',
    id, namn, epost, 'admin', await hasha(losenord, salt), salt, Date.now());
  return { id };
};

/* ══ Router ══ */

const OSKYDDADE = ['logga-in', 'logga-ut', 'installera'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/halsa') {
      return svar(request, { ok: true, tjanst: 'autoads-falt' });
    }

    if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) {
      return svar(request, { ok: false, fel: 'Okänd endpoint' }, 404);
    }

    const namn = url.pathname.slice(5);
    const fn = Object.prototype.hasOwnProperty.call(api, namn) ? api[namn] : null;
    if (!fn) return svar(request, { ok: false, fel: 'Okänd endpoint' }, 404);

    try {
      const body = (await request.json().catch(() => ({}))) || {};
      const anv = OSKYDDADE.includes(namn) ? null : await anvandareFranToken(env, request, body);
      const data = await fn(env, request, body || {}, anv);
      return svar(request, { ok: true, ...data });
    } catch (err) {
      if (err instanceof Fel) return svar(request, { ok: false, fel: err.message }, err.status);
      console.error('Fel i ' + namn + ':', err && err.message, err && err.stack);
      return svar(request, { ok: false, fel: 'Serverfel' }, 500);
    }
  },
};
