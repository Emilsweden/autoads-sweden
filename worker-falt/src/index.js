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
  besiktare: 'Besiktare',
  saljadmin: 'Admin Besiktare',
  teamleader: 'Teamleader',
  admin: 'Admin',
};

/** Rollerna Mötesbokare+ får lägga upp och ändra. Inte teamleader eller admin. */
const BOKARE_PLUS_ROLLER = ['saljare', 'bokare_plus', 'besiktare', 'saljadmin'];

/**
 * knacka            karta, adressregister, dörrbesök, statistik
 * boka              lägga en bokning
 * se_tider          se vilka tider som går att boka och vem de tillhör
 * styr_tider        lägga till, ta bort och blockera tider åt alla besiktare
 * eget_schema       styra sina egna tider
 * allt_bokat        se och ändra alla bokningar, inte bara sina egna
 * byt_besiktare     flytta ett möte till en annan besiktare
 * aterkoppla        lämna omdöme på sina egna möten
 * aterkoppla_alla   lämna omdöme på vilket möte som helst
 * all_aterkoppling  se all återkoppling
 * radera            radera bokningar och dörrar
 * radera_egna       radera det man själv bokat, innan mötet fått ett omdöme
 * skapa_konton      lägga upp och ändra konton i laget
 * skapa_besiktare   lägga upp och ändra besiktarnas konton — och bara dem
 * se_personal       se vilka som finns i laget
 */
const FORMAGOR = {
  saljare: ['knacka', 'boka', 'se_tider', 'radera_egna'],
  bokare_plus: ['knacka', 'boka', 'se_tider', 'styr_tider', 'allt_bokat', 'byt_besiktare',
    'all_aterkoppling', 'aterkoppla_alla', 'radera', 'skapa_konton', 'se_personal'],
  besiktare: ['eget_schema', 'aterkoppla', 'egna_moten'],
  // Admin Besiktare leder besiktarna men åker inte ut själv: inget eget
  // schema, inga egna möten, och han raderar inte det mötesbokarna bokat.
  saljadmin: ['se_tider', 'styr_tider', 'allt_bokat', 'byt_besiktare', 'all_aterkoppling',
    'aterkoppla_alla', 'skapa_besiktare', 'se_personal'],
  teamleader: ['*'],
  admin: ['*'],
};

/**
 * Bara rollerna i tabellen räknas. Utan hasOwnProperty skulle en trasig roll
 * som "constructor" hämta något ur Object.prototype i stället för en lista.
 */
const formagorFor = (roll) =>
  (Object.prototype.hasOwnProperty.call(FORMAGOR, roll) ? FORMAGOR[roll] : null) || [];

const far = (anv, formaga) => {
  const lista = formagorFor(anv && anv.roll);
  return lista.includes('*') || lista.includes(formaga);
};

function kraverFormaga(anv, formaga) {
  if (!far(anv, formaga)) throw new Fel('Du har inte behörighet till detta', 403);
}

/**
 * Rollen som kör besiktningar och därför har ett schema och egna möten. Bara
 * den går att boka — Admin Besiktare styr besiktarna men står aldrig själv
 * bland dem man kan välja.
 */
const BESIKTARROLLER = ['besiktare'];
const arBesiktare = (anv) => !!anv && BESIKTARROLLER.includes(anv.roll);
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
/*
 * Kalendern har inget rutnät. En tid finns för att en besiktare lagt in den,
 * ingenting annat — därför är en dag tom tills någon fyllt den.
 *
 * Det här är gränserna för vad som går att lägga in, inte ett schema:
 * halvtimmessteg, och en dygnsgräns så att en felskrivning inte hamnar
 * mitt i natten.
 */
const KALENDER = {
  TIDIGAST: '06:00',
  SENAST: '22:00',
  STEG: 30,          // minuter mellan giltiga starttider
  LANGD: 60,         // ett möte är en timme
};

const iMinuter = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const iKlockslag = (m) =>
  String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** Rensar en lista klockslag till giltiga, unika och sorterade tider. */
function rensaTider(lista) {
  const giltiga = mojligaTider();
  return [...new Set((Array.isArray(lista) ? lista : String(lista || '').split(','))
    .map((t) => klockslag(String(t).trim())).filter((t) => t && giltiga.includes(t)))].sort();
}

/**
 * Halvtimmarna en besiktare kan välja mellan när han lägger in sin dag —
 * inom hans arbetstid, eller hela dygnsgränsen utan ram.
 */
function mojligaTider(ram) {
  const ut = [];
  const fran = iMinuter((ram && ram.fran) || KALENDER.TIDIGAST);
  const till = iMinuter((ram && ram.till) || KALENDER.SENAST);
  for (let m = fran; m <= till; m += KALENDER.STEG) {
    ut.push(iKlockslag(m));
  }
  return ut;
}

/** Veckodag 0–6 för ett datum, uträknat utan tidszon. */
function veckodag(d) {
  return new Date(d + 'T12:00:00Z').getUTCDay();
}

/**
 * Kontrollerar tiden på servern, inte bara i appen. Helger är tillåtna nu:
 * det är besiktaren som avgör när han jobbar, inte ett öppettidsschema.
 */
function kontrolleraSlot(dat, tid) {
  if (!datum(dat) || !klockslag(tid)) throw new Fel('Datum och tid krävs');
  const m = iMinuter(tid);
  if (m < iMinuter(KALENDER.TIDIGAST) || m > iMinuter(KALENDER.SENAST)) {
    throw new Fel('Tiden ligger utanför ' + KALENDER.TIDIGAST + '–' + KALENDER.SENAST);
  }
  if (m % KALENDER.STEG !== 0) {
    throw new Fel('Tiden måste vara hel eller halv timme');
  }
}

const TIDEN_TAGEN = 'Tiden är redan bokad – välj en annan tid';
const TIDEN_STANGD = 'Besiktaren har inte lagt in den tiden';

/** Besiktarna möten kan bokas på. */
function saljarlista(env) {
  return alla(env,
    `SELECT id, namn, roll, max_per_dag, arbetstid_fran, arbetstid_till FROM anvandare
     WHERE roll = 'besiktare' AND aktiv = 1 ORDER BY namn`);
}

/**
 * Hur många möten besiktaren tar på en dag. Taket sitter på kontot, inte i
 * koden — en kör två tak om dagen, en annan tre, och det ändras i
 * användarlistan när det behövs.
 */
const MAX_PER_DAG = 3;
const takFor = (a) => nr(a && a.max_per_dag, MAX_PER_DAG) || MAX_PER_DAG;

/**
 * Arbetstiden är ramen för besiktarens dag. En tid utanför den syns inte och
 * går inte att boka — men ligger kvar, så att den kommer tillbaka om
 * arbetstiden ändras. Slutet räknas med: 09–18 har en tid 18:00.
 */
const ARBETSTID = { FRAN: '09:00', TILL: '18:00' };
const arbetstid = (a) => ({
  fran: klockslag(a && a.arbetstid_fran) || ARBETSTID.FRAN,
  till: klockslag(a && a.arbetstid_till) || ARBETSTID.TILL,
});

/** Minuter mellan två mötens starttider hos samma besiktare. */
const MELLANRUM = 180;

/** Datum och klockslag just nu i Sverige — där mötena äger rum. */
function stockholmNu(nu = Date.now()) {
  const d = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nu)).map((p) => [p.type, p.value]));
  return { datum: d.year + '-' + d.month + '-' + d.day, tid: d.hour + ':' + d.minute };
}

/**
 * Vilka tider går att boka? Samma regler överallt — lediga dagar, tiderna i
 * bokningen, kalendern, schemat — så att appen aldrig erbjuder något servern
 * sedan nekar. En tid är bokningsbar när den
 *
 *   är inlagd av besiktaren (eller åt honom) och inte blockerad,
 *   ligger inom hans arbetstid,
 *   inte redan har varit,
 *   inte ligger närmare än tre timmar från ett annat av hans möten, och
 *   han inte redan har fullt den dagen.
 *
 * Ren beräkning utan databas, så att regeln går att läsa på ett ställe.
 */
function raknaBokbara({ besiktare, tider, bokningar, nu }) {
  const per = new Map(besiktare.map((b) => [b.id, b]));
  const moten = new Map();
  for (const b of bokningar) {
    if (!b.saljare_id) continue;
    const n = b.saljare_id + '|' + b.datum;
    if (!moten.has(n)) moten.set(n, []);
    moten.get(n).push(b.tid ? iMinuter(b.tid) : null);
  }
  const ut = [];
  for (const t of tider) {
    const b = per.get(t.saljare_id);
    if (!b || !nr(t.ledig)) continue;
    const ram = arbetstid(b);
    if (t.tid < ram.fran || t.tid > ram.till) continue;
    if (t.datum < nu.datum || (t.datum === nu.datum && t.tid <= nu.tid)) continue;
    const dagens = moten.get(t.saljare_id + '|' + t.datum) || [];
    if (dagens.length >= takFor(b)) continue;
    const m = iMinuter(t.tid);
    if (dagens.some((x) => x !== null && Math.abs(x - m) < MELLANRUM)) continue;
    ut.push({ datum: t.datum, tid: t.tid, saljare_id: b.id, namn: b.namn });
  }
  return ut.sort((a, b) => a.datum.localeCompare(b.datum) || a.tid.localeCompare(b.tid) ||
    a.namn.localeCompare(b.namn, 'sv'));
}

/** Längsta intervall som räknas i ett anrop — en Worker har begränsad tid. */
const MAX_DAGAR = 190;

/**
 * De bokningsbara tiderna i ett intervall, hämtade med tre frågor oavsett
 * hur många dagar och besiktare det gäller. `utom` räknar bort en bokning —
 * den som flyttas ska inte stå i vägen för sig själv.
 */
async function bokbara(env, { fran, till, tid, saljareId, utom } = {}) {
  if (!fran || !till || till < fran) return [];
  if (dagarMellanAntal(fran, till) > MAX_DAGAR) throw new Fel('Välj ett kortare intervall');
  let besiktare = await saljarlista(env);
  if (saljareId) besiktare = besiktare.filter((b) => b.id === saljareId);
  if (!besiktare.length) return [];

  const tider = await alla(env,
    `SELECT saljare_id, datum, tid, ledig FROM saljartider
     WHERE datum >= ?1 AND datum <= ?2 AND ledig = 1 AND (?3 IS NULL OR tid = ?3)`,
    fran, till, tid || null);
  const bokningar = await alla(env,
    `SELECT saljare_id, datum, tid FROM bokningar
     WHERE datum >= ?1 AND datum <= ?2 AND status <> 'avbokad'
       AND saljare_id IS NOT NULL AND id <> ?3`,
    fran, till, utom || '');
  return raknaBokbara({ besiktare, tider, bokningar, nu: stockholmNu() });
}

/** Antal dagar från och med `fran` till och med `till`. */
function dagarMellanAntal(fran, till) {
  return Math.round((Date.parse(till + 'T12:00:00Z') - Date.parse(fran + 'T12:00:00Z')) / DAG) + 1;
}

/** Minutsiffran för ett klockslag i en kolumn, räknad i SQL. */
const minuterSql = (kol) =>
  `(CAST(substr(${kol}, 1, 2) AS INTEGER) * 60 + CAST(substr(${kol}, 4, 2) AS INTEGER))`;

/**
 * Samma regler som raknaBokbara, som ett villkor i SQL. Det sitter i WHERE
 * på själva skrivningen, så att en bokning bara sparas om den fortfarande
 * är tillåten i samma ögonblick som den skrivs. Två mötesbokare som trycker
 * samtidigt kan då inte båda få en tid som tillsammans bryter mot taket
 * eller tretimmarsregeln — det unika indexet fångar bara exakt samma tid.
 *
 * `p` är numret på första parametern; värdena kommer från vaktVarden().
 */
function bokbarVakt(p) {
  const [s, d, t, tm, jag, idag, kl] = [0, 1, 2, 3, 4, 5, 6].map((i) => '?' + (p + i));
  return `EXISTS (SELECT 1 FROM saljartider
            WHERE saljare_id = ${s} AND datum = ${d} AND tid = ${t} AND ledig = 1)
    AND EXISTS (SELECT 1 FROM anvandare
            WHERE id = ${s} AND aktiv = 1 AND roll = 'besiktare'
              AND ${t} >= COALESCE(arbetstid_fran, '${ARBETSTID.FRAN}')
              AND ${t} <= COALESCE(arbetstid_till, '${ARBETSTID.TILL}'))
    AND NOT EXISTS (SELECT 1 FROM bokningar
            WHERE saljare_id = ${s} AND datum = ${d} AND status <> 'avbokad' AND id <> ${jag}
              AND tid IS NOT NULL AND tid <> ''
              AND ABS(${minuterSql('tid')} - ${tm}) < ${MELLANRUM})
    AND (SELECT COUNT(*) FROM bokningar
            WHERE saljare_id = ${s} AND datum = ${d} AND status <> 'avbokad' AND id <> ${jag})
        < (SELECT CASE WHEN max_per_dag > 0 THEN max_per_dag ELSE ${MAX_PER_DAG} END
            FROM anvandare WHERE id = ${s})
    AND (${d} > ${idag} OR (${d} = ${idag} AND ${t} > ${kl}))`;
}
const vaktVarden = (saljareId, dat, tid, utom) => {
  const nu = stockholmNu();
  return [saljareId, dat, tid, iMinuter(tid), utom || '', nu.datum, nu.tid];
};

/**
 * Varför en viss besiktare inte går att boka på en tid — i den ordning
 * mötesbokaren har nytta av att få veta det.
 */
async function varforInteBokbar(env, saljareId, dat, tid, utom) {
  const b = await en(env,
    `SELECT id, namn, max_per_dag, arbetstid_fran, arbetstid_till FROM anvandare
     WHERE id = ?1 AND roll = 'besiktare' AND aktiv = 1`, saljareId);
  if (!b) return new Fel('Okänd besiktare');
  const rad = await en(env,
    'SELECT ledig, orsak FROM saljartider WHERE saljare_id = ?1 AND datum = ?2 AND tid = ?3',
    saljareId, dat, tid);
  if (rad && !nr(rad.ledig)) {
    return new Fel('Tiden är blockerad hos ' + b.namn + (rad.orsak ? ' (' + rad.orsak + ')' : ''), 409);
  }
  if (!rad) return new Fel(TIDEN_STANGD, 409);
  const ram = arbetstid(b);
  if (tid < ram.fran || tid > ram.till) {
    return new Fel('Tiden ligger utanför ' + b.namn + 's arbetstid ' + ram.fran + '–' + ram.till, 409);
  }
  const nu = stockholmNu();
  if (dat < nu.datum || (dat === nu.datum && tid <= nu.tid)) return new Fel('Tiden har redan varit', 409);

  const moten = await alla(env,
    `SELECT tid FROM bokningar WHERE saljare_id = ?1 AND datum = ?2 AND status <> 'avbokad' AND id <> ?3`,
    saljareId, dat, utom || '');
  if (moten.some((m) => m.tid === tid)) return new Fel(TIDEN_TAGEN, 409);
  if (moten.length >= takFor(b)) return new Fel(b.namn + ' har fullt den dagen', 409);
  const nara = moten.find((m) => m.tid && Math.abs(iMinuter(m.tid) - iMinuter(tid)) < MELLANRUM);
  if (nara) {
    return new Fel(b.namn + ' har ett möte kl. ' + nara.tid +
      ' — det måste vara minst 3 timmar mellan mötena', 409);
  }
  return new Fel(TIDEN_TAGEN, 409);
}

/**
 * Vilken besiktare mötet ska bokas på.
 *
 * Ett möte hör alltid till en besiktare — det är hans tid som bokas upp.
 * Anger appen ingen, och bara en enda besiktare kan ta tiden, blir det han;
 * kan flera måste mötesbokaren välja, för det är ett val och inte något
 * servern ska gissa åt honom. Det här är kontrollen som ger ett begripligt
 * fel; den slutliga ligger i bokbarVakt() på själva skrivningen.
 */
async function valjSaljare(env, onskad, dat, tid, utom) {
  const id = txt(onskad, 40);
  if (!dat || !tid) {
    if (id && !(await en(env, `SELECT id FROM anvandare WHERE id = ?1 AND roll = 'besiktare' AND aktiv = 1`, id))) {
      throw new Fel('Okänd besiktare');
    }
    return id || null;
  }

  const lediga = await bokbara(env, { fran: dat, till: dat, tid, utom });
  if (id) {
    if (lediga.some((l) => l.saljare_id === id)) return id;
    throw await varforInteBokbar(env, id, dat, tid, utom);
  }
  if (lediga.length === 1) return lediga[0].saljare_id;
  if (lediga.length) throw new Fel('Välj vilken besiktare som ska ta mötet', 409);

  // Ingen kan — men det är skillnad på att tiden inte finns och att någon
  // hann före. Det senare händer mitt i en bokning och ska sägas rätt.
  const finns = await en(env,
    `SELECT t.id FROM saljartider t
     JOIN anvandare a ON a.id = t.saljare_id AND a.aktiv = 1 AND a.roll = 'besiktare'
     WHERE t.datum = ?1 AND t.tid = ?2 AND t.ledig = 1`, dat, tid);
  throw new Fel(finns ? TIDEN_TAGEN : 'Ingen besiktare har lagt in den tiden', 409);
}

/** Känner igen krocken med det unika indexet, oavsett hur D1 formulerar den. */
const arKrock = (e) => /UNIQUE|constraint/i.test(String((e && e.message) || e));

/**
 * Skriver en rad i nyhetsflödet. anvandare_id är den som gjorde saken och
 * saljare_id säljaren det rör — tillsammans avgör de vem som får se raden.
 */
async function nyhet(env, typ, text, extra = {}) {
  const nu = Date.now();

  // Lägger en besiktare in fyra tider på en kvart är det en sak som hänt,
  // inte fyra. Samma typ, samma person, inom en kvart skriver om raden i
  // stället för att lägga en till.
  if (SLASIHOP.includes(typ) && extra.ihop) {
    const senaste = await en(env,
      `SELECT id FROM nyheter WHERE typ = ?1 AND anvandare_id = ?2 AND saljare_id IS ?3
         AND skapad > ?4 AND text LIKE ?5 ORDER BY skapad DESC LIMIT 1`,
      typ, extra.anvandare_id || null, extra.saljare_id || null, nu - IHOP_FONSTER,
      String(extra.ihop).slice(0, 200) + '%');
    if (senaste) {
      return kor(env, 'UPDATE nyheter SET text = ?1, skapad = ?2 WHERE id = ?3',
        String(text).slice(0, 400), nu, senaste.id);
    }
  }

  return kor(env,
    `INSERT INTO nyheter (id,typ,text,bokning_id,saljare_id,anvandare_id,skapad)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`,
    uid(), typ, String(text).slice(0, 400), extra.bokning_id || null,
    extra.saljare_id || null, extra.anvandare_id || null, nu);
}

/* Typer där flera ändringar i rad är samma händelse — men bara när de rör
   samma sak, vilket `ihop` säger. Fyra tider på torsdagen blir en notis;
   torsdagen och fredagen förblir två. En bokning är alltid sin egen. */
const SLASIHOP = ['tid', 'blockering'];
const IHOP_FONSTER = 15 * 60 * 1000;

/**
 * Skickar ett brev via en e-posttjänst med HTTP-API (Resend som standard).
 * Cloudflare Workers kan inte prata SMTP, så det måste gå via en tjänst.
 *
 * Sätts nycklarna inte hoppas brevet tyst över — appen ska fungera utan
 * e-post, och en bokning får aldrig falla för att posten strular. Krävs:
 *
 *   npx wrangler secret put EPOST_NYCKEL     API-nyckeln hos tjänsten
 *   npx wrangler secret put EPOST_AVSANDARE  t.ex. "Villa Takrenovering <no-reply@dindoman.se>"
 *
 * EPOST_URL kan pekas om till en annan tjänst med samma form.
 */
async function skickaEpost(env, till, amne, text) {
  if (!env.EPOST_NYCKEL || !env.EPOST_AVSANDARE || !till) return false;
  try {
    const svar = await fetch(env.EPOST_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.EPOST_NYCKEL,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EPOST_AVSANDARE, to: [till], subject: amne, text }),
    });
    if (!svar.ok) console.log('E-post gick inte fram (' + svar.status + '): ' + (await svar.text()).slice(0, 300));
    return svar.ok;
  } catch (e) {
    console.log('E-post gick inte fram: ' + e.message);
    return false;
  }
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

/**
 * Vem som får ändra en bokning: den som ser allt, mötesbokaren som bokade
 * den, och besiktaren som ska köra mötet.
 */
async function farAndraBokning(env, anv, bokning) {
  if (far(anv, 'allt_bokat')) return true;
  if (far(anv, 'boka') && bokning.anvandare_id === anv.id) return true;
  if (arBesiktare(anv)) return farSeBokning(env, anv, bokning);
  return false;
}

/**
 * Att flytta ett möte till en annan besiktare är Mötesbokare+ och Admin
 * Besiktares sak. Mötesbokaren flyttar sin bokning i tid hos samma besiktare;
 * besiktaren flyttar inte sina möten till någon annan.
 */
const farBytaBesiktare = (anv) => far(anv, 'byt_besiktare');

/**
 * Radera en bokning helt. Mötesbokare+ allt; en mötesbokare det han själv
 * bokat, så länge mötet inte fått något omdöme — då är det lagets historik.
 */
async function farRadera(env, anv, bokning) {
  if (far(anv, 'radera')) return true;
  if (!far(anv, 'radera_egna') || bokning.anvandare_id !== anv.id) return false;
  const omdome = await en(env, 'SELECT id FROM aterkoppling WHERE bokning_id = ?1 LIMIT 1', bokning.id);
  return !omdome;
}

/**
 * Vad den inloggade får göra med en bokning, som flaggor på raden. Appen
 * visar knapparna efter dem — servern kontrollerar samma sak igen när
 * knappen trycks. `harOmdome`: mötet har fått ett omdöme.
 */
function flaggor(anv, b, harOmdome) {
  const egenBokare = far(anv, 'boka') && b.anvandare_id === anv.id;
  const egenBesiktare = arBesiktare(anv) && (b.saljare_id === anv.id || !b.saljare_id);
  return {
    far_andra: far(anv, 'allt_bokat') || egenBokare || egenBesiktare,
    far_byt_besiktare: farBytaBesiktare(anv),
    far_avboka: b.status !== 'avbokad' && !arBesiktare(anv) && (far(anv, 'allt_bokat') || b.anvandare_id === anv.id),
    far_radera: far(anv, 'radera') || (far(anv, 'radera_egna') && b.anvandare_id === anv.id && !harOmdome),
  };
}

/** Id:n bland bokningarna som har fått ett omdöme. */
async function medOmdome(env, idn) {
  if (!idn.length) return new Set();
  const p = idn.map((_, i) => '?' + (i + 1)).join(',');
  return new Set((await alla(env,
    `SELECT DISTINCT bokning_id FROM aterkoppling WHERE bokning_id IN (${p})`, ...idn)).map((r) => r.bokning_id));
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
/** En sats som inte körs än — för iSamma(). */
const sats = (env, sql, ...a) => env.DB.prepare(sql).bind(...a);
/** Kör satserna som en transaktion: alla eller inga. */
const iSamma = (env, satser) => env.DB.batch(satser);
const andradeRader = (res) => nr(res && res.meta && res.meta.changes, 0);

/**
 * Normaliserar en adress till en unik nyckel så att "Västeråsvägen 1",
 * "västeråsvägen 1 " och "Västeråsvägen  1" blir samma dörr.
 *
 * Även mellanslag och bindestreck tas bort: anteckningar skrivs "Vinkel gatan"
 * där registret har "Vinkelgatan", och det är samma dörr.
 */
/**
 * Postnummer lagras som fem siffror utan mellanslag, så att "721 34" och
 * "72134" är samma sak. Är det inte fem siffror sparas ingenting alls —
 * ett halvt postnummer är sämre än inget.
 */
function postnummer(v) {
  const rensat = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  return rensat.length === 5 ? rensat : null;
}

/** "72134" visas som "721 34". */
const visaPostnummer = (p) => (p && p.length === 5 ? p.slice(0, 3) + ' ' + p.slice(3) : (p || ''));

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

/**
 * Siffrorna över laget är chefernas — Mötesbokare+ och Admin Besiktare.
 * En vanlig mötesbokare knackar dörrar men ser inte hela lagets utfall.
 */
function kraverStatistik(anv) {
  if (!far(anv, 'se_personal')) throw new Fel('Statistiken är för Mötesbokare+ och Admin Besiktare', 403);
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
  formagor: formagorFor(anv.roll),
  max_per_dag: takFor(anv),
  snabbtider: anv.snabbtider || '',
  arbetstid: arbetstid(anv),
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
      `SELECT id, namn, epost, roll, team, aktiv, skapad, max_per_dag, snabbtider,
              arbetstid_fran, arbetstid_till
       FROM anvandare ORDER BY roll DESC, namn`),
  };
};

/**
 * Lägger upp och ändrar konton. Administratören sköter alla; Mötesbokare+
 * sköter laget — mötesbokare, besiktare, Admin Besiktare och andra
 * Mötesbokare+ — men kommer inte åt administratörernas konton och kan inte
 * göra någon till administratör. Admin Besiktare sköter bara besiktarna:
 * han lägger upp besiktare, ändrar deras inställningar, och kan varken ge
 * någon en annan roll eller röra sitt eget konto. Gränsen ligger här, inte
 * i menyn.
 */
api['anvandare-spara'] = async (env, request, body, anv) => {
  const baraBesiktare = !far(anv, 'skapa_konton');
  if (baraBesiktare) kraverFormaga(anv, 'skapa_besiktare');
  const namn = txt(body.namn, 80);
  const epost = (txt(body.epost, 160) || '').toLowerCase();
  const roll = Object.prototype.hasOwnProperty.call(ROLLER, body.roll) ? body.roll : 'saljare';
  if (!namn || !epost) throw new Fel('Namn och e-post krävs');

  const helAdmin = rang(anv.roll) >= ROLLER.admin;
  const tillatna = baraBesiktare ? ['besiktare'] : BOKARE_PLUS_ROLLER;
  if (!helAdmin && !tillatna.includes(roll)) {
    throw new Fel('Du kan inte lägga upp den rollen', 403);
  }

  const ram = arbetstidUr(body);
  const maxPerDag = body.max_per_dag === undefined ? null
    : Math.max(1, Math.min(20, Math.round(nr(body.max_per_dag, MAX_PER_DAG))));

  if (body.id) {
    const finns = await en(env, 'SELECT roll FROM anvandare WHERE id = ?1', txt(body.id, 40));
    if (!finns) throw new Fel('Användaren finns inte', 404);
    if (!helAdmin && !tillatna.includes(finns.roll)) {
      throw new Fel(baraBesiktare ? 'Du sköter bara besiktarnas konton' : 'Det kontot sköts av en administratör', 403);
    }
    // En besiktare med möten framför sig kan inte byta roll eller stängas av
    // — mötena skulle bli kvar hos någon som inte längre går att boka.
    if (finns.roll === 'besiktare' && (roll !== 'besiktare' || body.aktiv === false)) {
      const kommande = await en(env,
        `SELECT COUNT(*) AS n FROM bokningar WHERE saljare_id = ?1 AND datum >= ?2 AND status <> 'avbokad'`,
        body.id, stockholmNu().datum);
      if (nr(kommande && kommande.n)) {
        throw new Fel('Besiktaren har ' + kommande.n + ' kommande möten — flytta dem först', 409);
      }
    }
    await kor(env,
      `UPDATE anvandare SET namn=?1, epost=?2, roll=?3, team=?4, aktiv=?5,
         max_per_dag=COALESCE(?7, max_per_dag), snabbtider=COALESCE(?8, snabbtider),
         arbetstid_fran=COALESCE(?9, arbetstid_fran), arbetstid_till=COALESCE(?10, arbetstid_till)
       WHERE id=?6`,
      namn, epost, roll, txt(body.team, 60), body.aktiv === false ? 0 : 1, body.id,
      maxPerDag, body.snabbtider === undefined ? null : rensaTider(body.snabbtider).join(','),
      ram ? ram.fran : null, ram ? ram.till : null);
    if (body.losenord) {
      if (String(body.losenord).length < 8) throw new Fel('Lösenordet måste vara minst 8 tecken');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      await kor(env, 'UPDATE anvandare SET hash=?1, salt=?2 WHERE id=?3',
        await hasha(String(body.losenord), salt), salt, body.id);
      await kor(env, 'DELETE FROM sessioner WHERE anvandare_id = ?1', body.id);
    }
    await nyhet(env, 'konto', anv.namn + ' ändrade kontot ' + namn +
      ' (' + (ROLLNAMN[roll] || roll) + ')', { anvandare_id: anv.id });
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
    `INSERT INTO anvandare (id,namn,epost,roll,team,hash,salt,aktiv,skapad,max_per_dag,arbetstid_fran,arbetstid_till)
     VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,?9,?10,?11)`,
    id, namn, epost, roll, txt(body.team, 60), await hasha(losenord, salt), salt, Date.now(),
    maxPerDag || MAX_PER_DAG, ram ? ram.fran : null, ram ? ram.till : null);
  await nyhet(env, 'konto', anv.namn + ' lade upp ' + namn +
    ' som ' + (ROLLNAMN[roll] || roll), { anvandare_id: anv.id });
  return { id };
};

/**
 * Arbetstiden ur ett formulär, kontrollerad: hela eller halva timmar inom
 * dygnsgränsen, och början före slutet. null om ingen skickades.
 */
function arbetstidUr(body) {
  if (body.arbetstid_fran === undefined && body.arbetstid_till === undefined) return null;
  const fran = klockslag(body.arbetstid_fran) || ARBETSTID.FRAN;
  const till = klockslag(body.arbetstid_till) || ARBETSTID.TILL;
  const giltiga = mojligaTider();
  if (!giltiga.includes(fran) || !giltiga.includes(till)) {
    throw new Fel('Arbetstiden ska vara hela eller halva timmar mellan ' + KALENDER.TIDIGAST + ' och ' + KALENDER.SENAST);
  }
  if (fran >= till) throw new Fel('Arbetstiden måste börja innan den slutar');
  return { fran, till };
}

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
    const postnr = postnummer(a.postnummer);
    const nyckel = adressnyckel(gata, nummer, postort);

    const befintlig = await hittaAdress(env, gata, nummer, postort);
    if (befintlig) {
      fanns++;
      // Fyll på med koordinater om den gamla raden saknar dem.
      if (a.lat && a.lon) {
        await kor(env, 'UPDATE adresser SET lat = COALESCE(lat, ?1), lon = COALESCE(lon, ?2) WHERE id = ?3',
          nr(a.lat, null), nr(a.lon, null), befintlig.id);
      }
      // Postnumret fylls på om raden saknar det — men skriver aldrig över ett.
      if (postnr) {
        await kor(env, 'UPDATE adresser SET postnummer = COALESCE(postnummer, ?1) WHERE id = ?2',
          postnr, befintlig.id);
      }
      continue;
    }
    await kor(env,
      `INSERT INTO adresser (id,omrade_id,gata,nummer,postnummer,postort,nyckel,lat,lon,status,skapad)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'ejbesokt',?10)`,
      uid(), omradeId, gata, nummer, postnr, postort, nyckel,
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
    postnummer: a.postnummer || null,
    postort: a.postort,
    adress: a.gata + ' ' + a.nummer,
    full_adress: a.gata + ' ' + a.nummer +
      (a.postnummer || a.postort
        ? ', ' + [visaPostnummer(a.postnummer), a.postort].filter(Boolean).join(' ')
        : ''),
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
    broschyr: nr(a.broschyr) ? 1 : 0,
    broschyr_av: a.broschyr_av || null,
    broschyr_namn: a.broschyr_namn || null,
    broschyr_tid: a.broschyr_tid || null,
  };
}

api['adress'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const id = txt(body.id, 40);
  const adress = await adressJagFar(env, anv, id,
    `SELECT a.*, u.namn AS senast_namn, br.namn AS broschyr_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     LEFT JOIN anvandare br ON br.id = a.broschyr_av
     WHERE a.id = ?1`);

  const historik = await alla(env,
    `SELECT h.*, u.namn AS saljare FROM handelser h
     LEFT JOIN anvandare u ON u.id = h.anvandare_id
     WHERE h.adress_id = ?1 ORDER BY h.skapad DESC LIMIT 100`, id);

  const bokningar = await alla(env,
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     WHERE b.adress_id = ?1 ORDER BY b.datum DESC, b.tid DESC LIMIT 50`, id);
  const omdomen = await medOmdome(env, bokningar.map((b) => b.id));

  return {
    adress: putsaAdress(adress),
    historik,
    bokningar: bokningar.map((b) => ({ ...b, ...flaggor(anv, b, omdomen.has(b.id)) })),
  };
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
  let bokSaljare = null;
  if (resultat === 'bokat') {
    if (bokTid && bokDatum) kontrolleraSlot(bokDatum, bokTid);
    bokSaljare = await valjSaljare(env, body.saljare_id, bokDatum, bokTid);
  }

  const aterkomDatum = datum(body.aterkom_datum);
  const oppnade = resultat === 'ejsvar' ? 0 : 1;
  const positiv = resultat === 'bokat' || resultat === 'aterkom' ? 1 : 0;
  const handelseId = uid();

  const status = resultat === 'bokat' ? 'bokat'
    : resultat === 'nej' ? 'nej'
    : resultat === 'aterkom' ? 'aterkom' : 'ejsvar';

  /*
   * Bokning, besök och dörrens status skrivs i en transaktion. Bokningen
   * först, med reglerna i sitt WHERE: nekas den skrivs varken besöket eller
   * dörrens nya status, så en tid som inte gick att få lämnar inga spår.
   */
  const bokningId = resultat === 'bokat' ? uid() : null;
  const bokningsKolumner = `(id,adress_id,handelse_id,anvandare_id,fornamn,efternamn,telefon,datum,tid,
            saljare_id,kommentar,status,skapad,stege)`;
  const bokningsVarden = [bokningId, adressId, handelseId, anv.id,
    txt(body.fornamn, 80), txt(body.efternamn, 80), txt(body.telefon, 40),
    bokDatum, bokTid, bokSaljare, txt(body.kommentar, 1000), nu, body.stege ? 1 : 0];
  const satser = [];
  if (bokningId && bokSaljare && bokDatum && bokTid) {
    satser.push(sats(env,
      `INSERT INTO bokningar ${bokningsKolumner}
       SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'bokad',?12,?13 WHERE ${bokbarVakt(14)}`,
      ...bokningsVarden, ...vaktVarden(bokSaljare, bokDatum, bokTid)));
  } else if (bokningId) {
    satser.push(sats(env,
      `INSERT INTO bokningar ${bokningsKolumner} VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'bokad',?12,?13)`,
      ...bokningsVarden));
  }
  const bokningFinns = '(?1 IS NULL OR EXISTS (SELECT 1 FROM bokningar WHERE id = ?1))';
  satser.push(sats(env,
    `INSERT INTO handelser
       (id,adress_id,anvandare_id,resultat,orsak,oppnade,positiv,aterkom_datum,aterkom_tid,kommentar,lat,lon,skapad)
     SELECT ?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14 WHERE ${bokningFinns}`,
    bokningId, handelseId, adressId, anv.id, resultat, txt(body.orsak, 80), oppnade, positiv,
    aterkomDatum, klockslag(body.aterkom_tid), txt(body.kommentar, 1000),
    body.lat === undefined ? null : nr(body.lat, null),
    body.lon === undefined ? null : nr(body.lon, null), nu));
  satser.push(sats(env,
    `UPDATE adresser SET status=?2, senast_tid=?3, senast_av=?4, senast_resultat=?5,
       sparrad_till=?6, aterkom_datum=?7, aterkom_tid=?8, antal_besok=antal_besok+1
     WHERE id=?9 AND ${bokningFinns}`,
    bokningId, status, nu, anv.id, resultat, sparrTill(resultat, aterkomDatum, inst, nu),
    aterkomDatum, klockslag(body.aterkom_tid), adressId));

  let resultatet;
  try {
    resultatet = await iSamma(env, satser);
  } catch (e) {
    if (arKrock(e)) throw new Fel(TIDEN_TAGEN, 409);
    throw e;
  }
  // Någon annan hann före mellan kontrollen och skrivningen.
  if (bokningId && !andradeRader(resultatet[0])) {
    throw await varforInteBokbar(env, bokSaljare, bokDatum, bokTid);
  }

  let bokning = null;
  if (resultat === 'bokat') {
    bokning = { id: bokningId, saljare_id: bokSaljare };

    const kund = [txt(body.fornamn, 80), txt(body.efternamn, 80)].filter(Boolean).join(' ');
    const huset = adress.gata + ' ' + adress.nummer;
    const nar = bokDatum ? bokDatum + (bokTid ? ' kl. ' + bokTid : '') : 'ingen tid satt';

    await nyhet(env, 'bokning',
      (kund || 'Kund') + ' — ' + nar + ' — ' + huset + ' (bokad av ' + anv.namn + ')',
      { bokning_id: bokningId, saljare_id: bokSaljare, anvandare_id: anv.id });

    // Besiktaren ska veta om mötet utan att öppna appen. Går brevet inte
    // iväg står bokningen ändå kvar — posten är ett meddelande, inte bokningen.
    if (bokSaljare) {
      const till = await en(env, 'SELECT namn, epost FROM anvandare WHERE id = ?1', bokSaljare);
      if (till && till.epost) {
        await skickaEpost(env, till.epost,
          'Ny bokning: ' + (kund || 'kund') + ' — ' + nar,
          [
            'Hej ' + till.namn + ',',
            '',
            'Du har fått en ny bokning.',
            '',
            'Kund:    ' + (kund || '—'),
            'Telefon: ' + (txt(body.telefon, 40) || '—'),
            'Adress:  ' + huset + (adress.postort ? ', ' + adress.postort : ''),
            'Tid:     ' + nar,
            'Stege:   ' + (body.stege ? 'JA — ta med stege' : 'nej'),
            'Bokad av: ' + anv.namn,
            txt(body.kommentar, 1000) ? '' : null,
            txt(body.kommentar, 1000) ? 'Anteckning: ' + txt(body.kommentar, 1000) : null,
            '',
            'Villa Takrenovering',
          ].filter((r) => r !== null).join('\n'));
      }
    }
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
  return hittaEllerSkapaAdress(env, anv, body);
};

/**
 * Kärnan i adress-ny, utan kravet på att vara mötesbokare: den som rättar
 * adressen på en bokning behöver samma sak. `omradeId` är ett område
 * anroparen redan kontrollerat — bokningens eget — och används som det är.
 */
async function hittaEllerSkapaAdress(env, anv, body, { omradeId: betrott } = {}) {
  const gata = snyggText(txt(body.gata, 120));
  const nummer = txt(body.nummer, 20).replace(/\s+/g, ' ').trim();
  if (!gata || !nummer) throw new Fel('Gata och husnummer krävs');
  const postort = snyggText(txt(body.postort, 80));
  const postnr = postnummer(body.postnummer);
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
    if (!befintlig.postnummer && postnr) {
      satt.push('postnummer=?' + (varden.push(postnr)));
      befintlig.postnummer = postnr;
    }
    if (satt.length) {
      await kor(env, 'UPDATE adresser SET ' + satt.join(', ') + ' WHERE id=?' + (varden.push(befintlig.id)), ...varden);
    }
    return { adress: putsaAdress(befintlig), fanns: true };
  }

  // Område: det säljaren valt, annars en samlingsplats för lösa adresser.
  const synliga = await synligaOmraden(env, anv);
  let omradeId = betrott || txt(body.omrade_id, 40);
  if (!betrott && (!omradeId || !synliga.some((o) => o.id === omradeId))) {
    let ovriga = synliga.find((o) => o.namn === 'Övriga adresser');
    if (!ovriga) {
      ovriga = { id: uid() };
      await kor(env, 'INSERT INTO omraden (id,namn,ort,skapad) VALUES (?1,?2,?3,?4)',
        ovriga.id, 'Övriga adresser', postort, Date.now());
    }
    omradeId = ovriga.id;
  }

  // Två som skapar samma dörr samtidigt får samma rad: den som kommer
  // andra hamnar på nyckeln och läser den första i stället för att krascha.
  const id = uid();
  const res = await kor(env,
    `INSERT INTO adresser (id,omrade_id,gata,nummer,postnummer,postort,nyckel,lat,lon,status,skapad)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'ejbesokt',?10) ON CONFLICT(nyckel) DO NOTHING`,
    id, omradeId, gata, nummer, postnr, postort, nyckel,
    body.lat === undefined ? null : nr(body.lat, null),
    body.lon === undefined ? null : nr(body.lon, null), Date.now());

  const skapad = await en(env, 'SELECT * FROM adresser WHERE nyckel = ?1', nyckel);
  return { adress: putsaAdress(skapad), fanns: !andradeRader(res) };
}

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
        { gata, nummer, postnummer: r.postnummer, postort: txt(r.postort, 80) || postort,
          omrade_id: omradeId }, anv);

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
  const postnr = body.postnummer === undefined ? adress.postnummer : postnummer(body.postnummer);
  const nyckel = adressnyckel(gata, nummer, postort);

  const krock = await en(env, 'SELECT id FROM adresser WHERE nyckel = ?1 AND id <> ?2', nyckel, id);
  if (krock) throw new Fel('En annan dörr har redan den adressen', 409);

  await kor(env,
    'UPDATE adresser SET gata=?1, nummer=?2, postort=?3, nyckel=?4, lat=?5, lon=?6, postnummer=?8 WHERE id=?7',
    gata, nummer, postort, nyckel,
    body.lat === undefined ? adress.lat : nr(body.lat, null),
    body.lon === undefined ? adress.lon : nr(body.lon, null), id, postnr);

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
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare, ad.gata, ad.nummer, ad.postort,
            ad.omrade_id, o.namn AS omrade
     FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id
     LEFT JOIN omraden o ON o.id = ad.omrade_id
     WHERE ${villkor.join(' AND ')}
     ORDER BY b.datum, b.tid LIMIT 1000`, ...args);

  if (!rader.length) return { bokningar: [], utfall: UTFALLSTEXT };

  // Återkopplingen följer med: månadslistan ska svara på hur mötet gick,
  // inte bara att det fanns.
  const idn = rader.map((b) => b.id);
  const p = idn.map((_, i) => '?' + (i + 1)).join(',');
  const aterkoppling = await alla(env,
    `SELECT a.*, u.namn AS forfattare FROM aterkoppling a
     LEFT JOIN anvandare u ON u.id = a.anvandare_id
     WHERE a.bokning_id IN (${p}) ORDER BY a.skapad`, ...idn);

  return {
    utfall: UTFALLSTEXT,
    bokningar: rader.map((b) => ({
      ...b,
      ...flaggor(anv, b, aterkoppling.some((a) => a.bokning_id === b.id)),
      adress: b.gata ? b.gata + ' ' + b.nummer : '',
      kund: [b.fornamn, b.efternamn].filter(Boolean).join(' '),
      aterkoppling: aterkoppling.filter((a) => a.bokning_id === b.id)
        .map((a) => ({ ...a, utfall_text: UTFALLSTEXT[a.utfall] || a.utfall })),
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

  // Bara det användaren får se: mötesbokaren sina egna bokningar, besiktaren
  // sina egna möten, de som ser allt allas.
  const args = [fran, till];
  const grans = await bokningsvillkor(env, anv);
  const villkor = grans.args.length ? ' AND ' + fyllPlatshallare(grans.sql, grans.args, args) : '';
  const rader = await alla(env,
    `SELECT b.id, b.datum, b.tid, b.fornamn, b.efternamn, b.telefon, b.kommentar, b.status,
            b.anvandare_id, b.saljare_id, b.lagenhet, u.namn AS bokare, sa.namn AS saljare,
            ad.gata, ad.nummer, ad.postort
     FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id
     WHERE b.datum >= ?1 AND b.datum <= ?2 AND b.status <> 'avbokad'${villkor}
     ORDER BY b.datum, b.tid LIMIT 2000`, ...args);

  const perDag = {};
  rader.forEach((b) => { perDag[b.datum] = (perDag[b.datum] || 0) + 1; });
  const omdomen = await medOmdome(env, rader.map((b) => b.id));

  // Tiderna som går att boka — inte allt som lagts in. En tid hos en
  // besiktare som redan är full, eller för nära ett annat möte, finns inte
  // här; den syns i besiktarens schema, inte i bokningskalendern.
  let fria = far(anv, 'se_tider') || arBesiktare(anv) ? await bokbara(env, { fran, till }) : [];
  if (!far(anv, 'se_tider')) fria = fria.filter((f) => f.saljare_id === anv.id);
  const ledigaPerDag = {};
  fria.forEach((f) => { ledigaPerDag[f.datum] = (ledigaPerDag[f.datum] || 0) + 1; });

  return {
    installningar: {
      tidigast: KALENDER.TIDIGAST, senast: KALENDER.SENAST,
      steg: KALENDER.STEG, langd: KALENDER.LANGD,
    },
    mojliga_tider: mojligaTider(),
    saljare: (await saljarlista(env)).map((s) => ({ id: s.id, namn: s.namn })),
    tider: fria.map((f) => ({ datum: f.datum, tid: f.tid, saljare_id: f.saljare_id, saljare: f.namn })),
    per_dag: perDag,
    lediga_per_dag: ledigaPerDag,
    far_styra: far(anv, 'styr_tider'),
    eget_schema: far(anv, 'eget_schema') ? anv.id : null,
    bokningar: rader.map((b) => ({
      ...b,
      ...flaggor(anv, b, omdomen.has(b.id)),
      adress: b.gata ? b.gata + ' ' + b.nummer : '',
      kund: [b.fornamn, b.efternamn].filter(Boolean).join(' '),
      min: true,
    })),
  };
};

/**
 * Vilka besiktare är lediga en viss tid? Det här är steget "Välj besiktare"
 * i bokningen — mötesbokaren ser namnen och bestämmer.
 */
api['lediga-besiktare'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'se_tider');
  const dat = datum(body.datum);
  const tid = klockslag(body.tid);
  if (!dat || !tid) throw new Fel('Datum och tid krävs');
  const lediga = await bokbara(env, { fran: dat, till: dat, tid, utom: txt(body.utom, 40) });
  return { besiktare: lediga.map((s) => ({ id: s.saljare_id, namn: s.namn })) };
};

/**
 * De bokningsbara tiderna, uträknade här och inte i telefonen.
 *
 *   { datum }              dagens tider och besiktarna som kan ta var och en
 *   { tid, fran, till }    "17:00 passar" — dagarna då någon kan ta den tiden
 *
 * `utom` är en bokning som flyttas: dess egen tid står inte i vägen.
 */
api['bokbara-tider'] = async (env, request, body, anv) => {
  // Besiktaren ser bara sina egna tider — han flyttar sina möten inom sin dag.
  const saljareId = far(anv, 'se_tider') ? undefined : (kraverFormaga(anv, 'eget_schema'), anv.id);
  const utom = txt(body.utom, 40);
  const tid = klockslag(body.tid);
  if (tid) {
    const fran = datum(body.fran) || stockholmNu().datum;
    const till = datum(body.till) || plusDagar(fran, 60);
    const lista = await bokbara(env, { fran, till, tid, utom, saljareId });
    return { tid, dagar: grupperaBokbara(lista, 'datum') };
  }
  const dat = datum(body.datum);
  if (!dat) throw new Fel('Datum eller tid krävs');
  const lista = await bokbara(env, { fran: dat, till: dat, utom, saljareId });
  return { datum: dat, tider: grupperaBokbara(lista, 'tid') };
};

/** [{ datum, tid, saljare_id, namn }] → [{ <nyckel>, besiktare: [{ id, namn }] }] */
function grupperaBokbara(lista, nyckel) {
  const per = new Map();
  for (const l of lista) {
    if (!per.has(l[nyckel])) per.set(l[nyckel], { [nyckel]: l[nyckel], besiktare: [] });
    per.get(l[nyckel]).besiktare.push({ id: l.saljare_id, namn: l.namn });
  }
  return [...per.values()];
}

/** Ett datum n dagar efter ett annat. */
function plusDagar(dat, n) {
  const d = new Date(dat + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

  // Besiktaren mötet ska ligga på, och att han går att boka då. Görs innan
  // adressen skapas, så att en nekad tid inte lämnar en tom dörr efter sig.
  const saljare = await valjSaljare(env, body.saljare_id, dat, tid);

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
      postnummer: body.postnummer,
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
    stege: body.stege,
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
 * Redigerar en bokning: kund, telefon, adress, lägenhet, datum, tid och
 * besiktare. Bokningen behåller sitt id — en ombokning är samma bokning på
 * en ny tid, inte en ny bokning och en avbokad.
 *
 * Flyttas den gäller samma regler som vid nybokning, och de sitter i själva
 * skrivningen: antingen flyttas bokningen dit och den gamla tiden blir fri,
 * eller så står den kvar orörd.
 */
api['bokning-andra'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  const bokning = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', id);
  if (!bokning) throw new Fel('Bokningen finns inte', 404);
  if (!(await farAndraBokning(env, anv, bokning))) throw new Fel('Bokningen tillhör någon annan', 403);

  const dat = body.datum === undefined ? bokning.datum : datum(body.datum);
  const tid = body.tid === undefined ? bokning.tid : klockslag(body.tid);
  let saljare = body.saljare_id === undefined ? bokning.saljare_id : (txt(body.saljare_id, 40) || null);
  if (saljare !== bokning.saljare_id && !farBytaBesiktare(anv)) {
    throw new Fel('Du kan inte flytta mötet till en annan besiktare', 403);
  }
  const flyttad = dat !== bokning.datum || tid !== bokning.tid || saljare !== bokning.saljare_id;
  if (flyttad && dat && tid) {
    kontrolleraSlot(dat, tid);
    saljare = await valjSaljare(env, saljare, dat, tid, id);
  }

  // Adressen: är den fel pekas bokningen om till rätt dörr. Dörren den stod
  // på står kvar med sin historik.
  let adressId = bokning.adress_id;
  if (body.gata !== undefined || body.nummer !== undefined || body.postort !== undefined) {
    const nu = await en(env, 'SELECT * FROM adresser WHERE id = ?1', bokning.adress_id);
    const gata = body.gata === undefined ? (nu && nu.gata) : txt(body.gata, 120);
    const nummer = body.nummer === undefined ? (nu && nu.nummer) : txt(body.nummer, 20);
    const postort = body.postort === undefined ? (nu && nu.postort) : txt(body.postort, 80);
    if (!gata || !nummer) throw new Fel('Adress med husnummer krävs');
    const ny = await hittaEllerSkapaAdress(env, anv,
      { gata, nummer, postort, postnummer: body.postnummer === undefined ? nu && nu.postnummer : body.postnummer },
      { omradeId: nu && nu.omrade_id });
    adressId = ny.adress.id;
  }

  const falt = (namn, max) => (body[namn] === undefined ? bokning[namn] : txt(body[namn], max));
  const varden = [
    falt('fornamn', 80), falt('efternamn', 80), falt('telefon', 40), dat, tid,
    falt('kommentar', 1000), saljare, id,
    body.stege === undefined ? nr(bokning.stege) : (body.stege ? 1 : 0),
    falt('lagenhet', 20), adressId, Date.now(), anv.id,
  ];
  const vakt = flyttad && dat && tid && saljare;
  let res;
  try {
    res = await kor(env,
      `UPDATE bokningar SET fornamn=?1, efternamn=?2, telefon=?3, datum=?4, tid=?5, kommentar=?6,
         saljare_id=?7, stege=?9, lagenhet=?10, adress_id=?11, andrad=?12, andrad_av=?13
       WHERE id=?8${vakt ? ' AND ' + bokbarVakt(14) : ''}`,
      ...varden, ...(vakt ? vaktVarden(saljare, dat, tid, id) : []));
  } catch (e) {
    if (arKrock(e)) throw new Fel(TIDEN_TAGEN, 409);
    throw e;
  }
  // Någon hann ta tiden mellan kontrollen och skrivningen.
  if (!andradeRader(res)) throw await varforInteBokbar(env, saljare, dat, tid, id);

  // Besöket som blev bokningen följer med till rätt dörr, och båda dörrarnas
  // status räknas om från sin historik.
  if (adressId !== bokning.adress_id) {
    if (bokning.handelse_id) {
      await kor(env, 'UPDATE handelser SET adress_id = ?1 WHERE id = ?2', adressId, bokning.handelse_id);
    }
    await raknaOmDorr(env, bokning.adress_id);
    await raknaOmDorr(env, adressId);
  }

  const uppdaterad = await en(env,
    `SELECT b.*, u.namn AS bokare, sa.namn AS saljare, ad.gata, ad.nummer FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
     LEFT JOIN anvandare sa ON sa.id = b.saljare_id
     LEFT JOIN adresser ad ON ad.id = b.adress_id WHERE b.id = ?1`, id);
  if (flyttad) {
    await nyhet(env, 'andring',
      anv.namn + ' flyttade mötet på ' + kortAdress(uppdaterad) + ' till ' +
      (dat || '(inget datum)') + (tid ? ' kl. ' + tid : '') +
      (saljare !== bokning.saljare_id && uppdaterad.saljare ? ' hos ' + uppdaterad.saljare : ''),
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
      ...flaggor(anv, b, aterkoppling.some((a) => a.bokning_id === b.id)),
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

/**
 * Adressökning i vårt eget register: "Björkvägen 17", "Björkvägen", "72134".
 *
 * Ligger först i sökkedjan för att den är gratis, omedelbar och innehåller
 * de adresser laget faktiskt jobbar med. Hittas inget här går appen vidare
 * till kartans adresstjänst.
 */
api['adress-sok'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const fraga = txt(body.fraga, 120);
  if (!fraga || fraga.length < 2) return { traffar: [] };

  const idn = await synligaOmradesIdn(env, anv);
  if (!idn.length) return { traffar: [] };

  // "Björkvägen 17" delas upp så att numret matchas för sig — annars skulle
  // sökningen på hela strängen missa allt utom exakta träffar.
  const delar = fraga.match(/^(.*?[^\d\s])\s+(\d+\s*[A-Za-zÅÄÖåäö]?)\s*$/);
  const gatDel = (delar ? delar[1] : fraga).trim();
  const numDel = delar ? delar[2].replace(/\s+/g, '') : '';
  const siffror = fraga.replace(/\D/g, '');

  const platshallare = idn.map((_, i) => '?' + (i + 1)).join(',');
  const n = idn.length;
  const rader = await alla(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av
     WHERE a.omrade_id IN (${platshallare})
       AND (a.gata LIKE ?${n + 1}
            OR (a.gata LIKE ?${n + 2} AND a.nummer = ?${n + 3})
            OR (?${n + 4} <> '' AND a.postnummer = ?${n + 4}))
     ORDER BY (a.nummer = ?${n + 3}) DESC, a.gata, CAST(a.nummer AS INTEGER), a.nummer
     LIMIT 25`,
    ...idn,
    numDel ? gatDel + '%' : fraga + '%',
    gatDel + '%',
    numDel,
    siffror.length === 5 ? siffror : '');

  return { traffar: rader.map(putsaAdress) };
};

/* ── Säljarnas tider ── */

/**
 * Besiktarnas scheman i ett datumintervall: inlagda tider, blockerade tider,
 * möten, och vilka av tiderna som faktiskt går att boka.
 *
 * Besiktaren ser bara sitt eget. Admin Besiktare och Mötesbokare+ ser alla
 * besiktares. Mötesbokaren behöver inte schemat alls — han får bara de
 * bokningsbara tiderna, via bokbara-tider och lediga-dagar.
 */
api['saljartider'] = async (env, request, body, anv) => {
  const styr = far(anv, 'styr_tider');
  if (!styr) kraverFormaga(anv, 'eget_schema');
  const fran = datum(body.fran) || datum(body.datum);
  const till = datum(body.till) || fran;
  if (!fran) throw new Fel('Datum krävs');
  if (dagarMellanAntal(fran, till) > 62) throw new Fel('Välj högst två månader åt gången');

  let saljare = await saljarlista(env);
  if (!styr) saljare = saljare.filter((s) => s.id === anv.id);
  const idn = new Set(saljare.map((s) => s.id));
  const dagar = dagarMellan(fran, till);

  const rader = (await alla(env,
    `SELECT saljare_id, datum, tid, ledig, orsak FROM saljartider
     WHERE datum >= ?1 AND datum <= ?2 ORDER BY tid`, fran, till))
    .filter((r) => idn.has(r.saljare_id));
  const moten = (await alla(env,
    `SELECT datum, tid, saljare_id FROM bokningar
     WHERE datum >= ?1 AND datum <= ?2 AND status <> 'avbokad' AND tid IS NOT NULL AND tid <> ''`,
    fran, till)).filter((b) => idn.has(b.saljare_id));
  const fria = raknaBokbara({
    besiktare: saljare, tider: rader, bokningar: moten, nu: stockholmNu(),
  });

  // { datum: { besiktare: [...] } } — samma form som förut, så att appen
  // slår upp en dag och en besiktare utan att leta.
  const tom = () => Object.fromEntries(dagar.map((d) => [d, Object.fromEntries(saljare.map((s) => [s.id, []]))]));
  const tider = tom(), blockerade = tom(), bokat = tom(), bokbaraPer = tom();
  for (const r of rader) {
    if (!tider[r.datum]) continue;
    if (nr(r.ledig)) tider[r.datum][r.saljare_id].push(r.tid);
    else blockerade[r.datum][r.saljare_id].push({ tid: r.tid, orsak: r.orsak || '' });
  }
  for (const b of moten) if (bokat[b.datum]) bokat[b.datum][b.saljare_id].push(b.tid);
  for (const f of fria) if (bokbaraPer[f.datum]) bokbaraPer[f.datum][f.saljare_id].push(f.tid);

  return {
    saljare: saljare.map((s) => ({
      id: s.id, namn: s.namn, max_per_dag: takFor(s), arbetstid: arbetstid(s),
      mojliga_tider: mojligaTider(arbetstid(s)),
    })),
    mojliga_tider: mojligaTider(),
    dagar,
    tider,
    blockerade,
    bokat,
    bokbara: bokbaraPer,
    far_styra: styr,
    eget_schema: far(anv, 'eget_schema') ? anv.id : null,
    mallar: Object.fromEntries((await alla(env,
      `SELECT id, snabbtider, arbetstid_fran, arbetstid_till FROM anvandare
       WHERE roll = 'besiktare' AND aktiv = 1`))
      .filter((r) => idn.has(r.id))
      .map((r) => [r.id, mallFor(r)])),
  };
};

/**
 * Besiktarens mall: tiderna han brukar ha. Har han ingen egen är mallen
 * varje halvtimme inom hans arbetstid — ett tryck fyller dagen.
 */
function mallFor(a) {
  const egen = (a.snabbtider || '').split(',').filter(Boolean);
  const ram = arbetstid(a);
  return egen.length ? egen.filter((t) => t >= ram.fran && t <= ram.till) : mojligaTider(ram);
}

/**
 * Kontrollerar att den inloggade får styra besiktarens schema och att
 * kontot verkligen är en besiktare. Besiktaren styr sitt eget; Admin
 * Besiktare och Mötesbokare+ allas.
 */
async function schemaJagFar(env, anv, saljareId) {
  if (saljareId !== anv.id || !far(anv, 'eget_schema')) kraverFormaga(anv, 'styr_tider');
  const saljare = await en(env,
    `SELECT id, namn, arbetstid_fran, arbetstid_till FROM anvandare
     WHERE id = ?1 AND roll = 'besiktare' AND aktiv = 1`, saljareId);
  if (!saljare) throw new Fel('Okänd besiktare');
  return saljare;
}

/** Tider utanför arbetstiden går inte att lägga in — de skulle ändå inte synas. */
function inomArbetstid(saljare, tider) {
  const ram = arbetstid(saljare);
  const utanfor = tider.filter((t) => t < ram.fran || t > ram.till);
  if (utanfor.length) {
    throw new Fel(utanfor.join(', ') + ' ligger utanför ' + saljare.namn + 's arbetstid ' +
      ram.fran + '–' + ram.till);
  }
}

/** Tiderna bland `tider` som redan har ett möte hos besiktaren. */
async function bokadeBland(env, saljareId, dat, tider) {
  const bokade = (await alla(env,
    `SELECT tid FROM bokningar WHERE saljare_id = ?1 AND datum = ?2 AND status <> 'avbokad'
       AND tid IS NOT NULL AND tid <> ''`, saljareId, dat)).map((b) => b.tid);
  return tider.filter((t) => bokade.includes(t));
}

/**
 * Sätter en besiktares inlagda tider för en dag. Hela dagen skickas på en
 * gång. Blockerade tider rörs inte — en blockering står kvar tills någon
 * tar bort just den, även om dagen sparas om eller mallen läggs in.
 */
api['saljartider-spara'] = async (env, request, body, anv) => {
  const dat = datum(body.datum);
  if (!dat) throw new Fel('Datum krävs');
  const saljare = await schemaJagFar(env, anv, txt(body.saljare_id, 40) || anv.id);
  const saljareId = saljare.id;

  const nya = rensaTider(body.tider);
  inomArbetstid(saljare, nya);

  // Tider som redan har ett möte kan inte tas bort — mötet står kvar och
  // skulle bli osynligt i kalendern.
  const gamla = (await alla(env,
    'SELECT tid FROM saljartider WHERE saljare_id = ?1 AND datum = ?2 AND ledig = 1', saljareId, dat))
    .map((r) => r.tid);
  const tappade = await bokadeBland(env, saljareId, dat, gamla.filter((t) => !nya.includes(t)));
  if (tappade.length) {
    throw new Fel('Tiden ' + tappade.join(', ') + ' har ett bokat möte — flytta det först', 409);
  }

  const nu = Date.now();
  await iSamma(env, [
    sats(env, 'DELETE FROM saljartider WHERE saljare_id = ?1 AND datum = ?2 AND ledig = 1', saljareId, dat),
    ...nya.map((t) => sats(env,
      `INSERT OR IGNORE INTO saljartider (id,saljare_id,datum,tid,ledig,satt_av,skapad)
       VALUES (?1,?2,?3,?4,1,?5,?6)`, uid(), saljareId, dat, t, anv.id, nu)),
  ]);

  const inledning = anv.namn +
    (saljareId === anv.id ? ' ändrade sina tider ' : ' ändrade ' + saljare.namn + 's tider ') + dat;
  await nyhet(env, 'tid',
    inledning + ' — ' + (nya.length ? nya.join(', ') : 'ingen tid alls'),
    { saljare_id: saljareId, anvandare_id: anv.id, ihop: inledning });

  const kvar = await alla(env,
    'SELECT tid FROM saljartider WHERE saljare_id = ?1 AND datum = ?2 AND ledig = 1 ORDER BY tid', saljareId, dat);
  return { datum: dat, saljare_id: saljareId, tider: kvar.map((r) => r.tid) };
};

const LAGEN = {
  lagg_till: 'lade till',
  ta_bort: 'tog bort',
  blockera: 'blockerade',
  avblockera: 'tog bort blockeringen av',
};

/**
 * Ändrar bara de tider som trycktes på — lägga till, ta bort, blockera,
 * avblockera. Två personer som ändrar samma dag skriver då inte över
 * varandras tider, vilket de gjorde när hela dagen skickades.
 *
 * `saljare_id: "alla"` blockerar (eller avblockerar) för alla besiktare på
 * en gång — ett personalmöte, en helgdag. Det får bara den som styr allas tider.
 */
api['saljartid-andra'] = async (env, request, body, anv) => {
  const dat = datum(body.datum);
  const lage = Object.prototype.hasOwnProperty.call(LAGEN, body.lage) ? body.lage : null;
  if (!dat || !lage) throw new Fel('Datum och vad som ska göras krävs');
  const tider = rensaTider(body.tider);
  if (!tider.length) throw new Fel('Välj minst en tid');
  const orsak = txt(body.orsak, 80);

  let lista;
  if (body.saljare_id === 'alla') {
    kraverFormaga(anv, 'styr_tider');
    if (lage !== 'blockera' && lage !== 'avblockera') throw new Fel('För alla besiktare går det bara att blockera');
    lista = await saljarlista(env);
  } else {
    lista = [await schemaJagFar(env, anv, txt(body.saljare_id, 40) || anv.id)];
  }

  const nu = Date.now();
  const satser = [];
  for (const s of lista) {
    if (lage === 'lagg_till') inomArbetstid(s, tider);
    // Ett bokat möte ligger kvar på sin tid — den kan inte tas bort eller
    // blockeras under mötet. För "alla" hoppas den besiktaren bara över.
    const bokade = (lage === 'ta_bort' || lage === 'blockera') ? await bokadeBland(env, s.id, dat, tider) : [];
    if (bokade.length && lista.length === 1) {
      throw new Fel(s.namn + ' har ett möte ' + bokade.join(', ') + ' — flytta det först', 409);
    }
    for (const t of tider.filter((x) => !bokade.includes(x))) {
      if (lage === 'lagg_till') {
        satser.push(sats(env,
          `INSERT INTO saljartider (id,saljare_id,datum,tid,ledig,satt_av,skapad) VALUES (?1,?2,?3,?4,1,?5,?6)
           ON CONFLICT(saljare_id, datum, tid) DO UPDATE SET ledig = 1, orsak = NULL, satt_av = ?5, skapad = ?6`,
          uid(), s.id, dat, t, anv.id, nu));
      } else if (lage === 'blockera') {
        satser.push(sats(env,
          `INSERT INTO saljartider (id,saljare_id,datum,tid,ledig,orsak,satt_av,skapad) VALUES (?1,?2,?3,?4,0,?5,?6,?7)
           ON CONFLICT(saljare_id, datum, tid) DO UPDATE SET ledig = 0, orsak = ?5, satt_av = ?6, skapad = ?7`,
          uid(), s.id, dat, t, orsak, anv.id, nu));
      } else {
        satser.push(sats(env,
          'DELETE FROM saljartider WHERE saljare_id = ?1 AND datum = ?2 AND tid = ?3 AND ledig = ?4',
          s.id, dat, t, lage === 'ta_bort' ? 1 : 0));
      }
    }
  }
  if (satser.length) await iSamma(env, satser);

  const vem = body.saljare_id === 'alla' ? 'alla besiktares'
    : lista[0].id === anv.id ? 'sina' : lista[0].namn + 's';
  const inledning = anv.namn + ' ' + LAGEN[lage] + ' ' + vem + ' tider ' + dat;
  await nyhet(env, lage === 'blockera' ? 'blockering' : 'tid',
    inledning + ' — ' + tider.join(', ') + (orsak ? ' (' + orsak + ')' : ''),
    { saljare_id: body.saljare_id === 'alla' ? null : lista[0].id, anvandare_id: anv.id, ihop: inledning });
  return { datum: dat, lage, tider };
};

/**
 * Besiktarens egen mall: tiderna han brukar ha. Ett tryck lägger in dem på
 * en dag i stället för ett tryck per timme — och alla kör inte 08–17.
 */
api['snabbtider-spara'] = async (env, request, body, anv) => {
  const saljare = await schemaJagFar(env, anv, txt(body.saljare_id, 40) || anv.id);
  const saljareId = saljare.id;

  const tider = rensaTider(body.tider);
  inomArbetstid(saljare, tider);
  await kor(env, 'UPDATE anvandare SET snabbtider = ?1 WHERE id = ?2', tider.join(','), saljareId);
  return { snabbtider: tider };
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

  // Den som körde mötet återkopplar. Admin Besiktare och Mötesbokare+ får
  // göra det på alla möten — och rätta det som skrivits.
  const min = far(anv, 'aterkoppla') && (bokning.saljare_id === anv.id ||
    (arBesiktare(anv) && !bokning.saljare_id && (await saljarlista(env)).length === 1));
  if (!min) kraverFormaga(anv, 'aterkoppla_alla');

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

  if (far(anv, 'allt_bokat') && far(anv, 'skapa_konton')) {
    // Mötesbokare+ och uppåt ser hela flödet — alla bokningar, alla
    // besiktare, alla mötesbokare, all återkoppling.
  } else if (far(anv, 'styr_tider')) {
    // Admin Besiktare ansvarar för hela besiktarsidan: allt som rör en
    // besiktare, oavsett vem som bokade.
    lagg('n.saljare_id IS NOT NULL');
  } else if (arBesiktare(anv)) {
    lagg('(n.saljare_id = ? OR n.anvandare_id = ?)', anv.id, anv.id);
  } else {
    lagg(`(n.anvandare_id = ? OR n.bokning_id IN
           (SELECT id FROM bokningar WHERE anvandare_id = ?))`, anv.id, anv.id);
  }

  // Det användaren själv svepat bort syns inte för honom — men står kvar
  // för alla andra. Därför en rad i nyhet_dold, aldrig en radering.
  villkor.push(`n.id NOT IN (SELECT nyhet_id FROM nyhet_dold WHERE anvandare_id = ?${args.push(anv.id)})`);

  const rader = await alla(env,
    `SELECT n.*, u.namn AS av FROM nyheter n
     LEFT JOIN anvandare u ON u.id = n.anvandare_id
     WHERE ${villkor.join(' AND ')}
     ORDER BY n.skapad DESC LIMIT ?${args.length + 1}`,
    ...args, Math.min(200, Math.max(1, nr(body.antal, 60))));

  return { nyheter: rader };
};

/**
 * Sveper man bort en nyhet försvinner den bara för en själv. Nyheten finns
 * kvar hos alla andra som ser den — det är en markering, inte en radering.
 */
api['nyhet-dolj'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  if (!id) throw new Fel('Nyhet saknas');
  await kor(env,
    'INSERT OR IGNORE INTO nyhet_dold (anvandare_id, nyhet_id, skapad) VALUES (?1,?2,?3)',
    anv.id, id, Date.now());
  return {};
};

/** Ångra: nyheten syns igen för den som svepte bort den. */
api['nyhet-visa'] = async (env, request, body, anv) => {
  await kor(env, 'DELETE FROM nyhet_dold WHERE anvandare_id = ?1 AND nyhet_id = ?2',
    anv.id, txt(body.id, 40));
  return {};
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

/**
 * Datumen som faktiskt går att boka: de där någon besiktare har en ledig
 * tid kvar och inte redan har fullt. Bokningskalendern visar bara dessa —
 * ingen ska behöva bläddra förbi tomma dagar för att hitta en tid.
 *
 * Det här är inte samma kalender som den där besiktarna lägger in tider.
 * Där måste alla dagar gå att välja, annars går en tom dag aldrig att fylla.
 */
api['lediga-dagar'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'se_tider');
  const fran = datum(body.fran) || stockholmNu().datum;
  const till = datum(body.till) || plusDagar(fran, 120);
  const lista = await bokbara(env, { fran, till, utom: txt(body.utom, 40) });

  const perDag = new Map();
  for (const l of lista) {
    if (!perDag.has(l.datum)) perDag.set(l.datum, { datum: l.datum, lediga: 0, besiktare: new Set() });
    const d = perDag.get(l.datum);
    d.lediga++;
    d.besiktare.add(l.namn);
  }
  return {
    dagar: [...perDag.values()]
      .map((d) => ({ datum: d.datum, lediga: d.lediga, besiktare: [...d.besiktare].sort() })),
  };
};

/**
 * Broschyr i brevlådan. Sparas på adressen med vem som lämnade den, så att
 * nästa som står vid dörren ser att någon redan varit där.
 */
api['adress-broschyr'] = async (env, request, body, anv) => {
  kraverKnackare(anv);
  const adress = await adressJagFar(env, anv, txt(body.id, 40));
  const lamnad = body.broschyr === false ? 0 : 1;
  await kor(env,
    'UPDATE adresser SET broschyr = ?1, broschyr_av = ?2, broschyr_tid = ?3 WHERE id = ?4',
    lamnad, lamnad ? anv.id : null, lamnad ? Date.now() : null, adress.id);
  return { broschyr: lamnad, broschyr_namn: lamnad ? anv.namn : null, broschyr_tid: lamnad ? Date.now() : null };
};

/**
 * Lite siffror om en användare, för Mötesbokare+ och Admin Besiktare.
 * Vanliga mötesbokare ser inte andras statistik.
 */
api['anvandare-statistik'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'se_personal');
  const id = txt(body.id, 40);
  const person = await en(env, `SELECT id, namn, epost, roll, team, aktiv, max_per_dag, snabbtider, arbetstid_fran, arbetstid_till
     FROM anvandare WHERE id = ?1`, id);
  if (!person) throw new Fel('Användaren finns inte', 404);
  const nu = new Date().toISOString().slice(0, 10);

  const som = arBesiktare(person) ? 'saljare_id' : 'anvandare_id';
  const rad = await en(env,
    `SELECT
       SUM(CASE WHEN status <> 'avbokad' AND datum >= ?2 THEN 1 ELSE 0 END) AS kommande,
       SUM(CASE WHEN status = 'genomford' THEN 1 ELSE 0 END) AS genomforda,
       SUM(CASE WHEN status = 'avbokad' THEN 1 ELSE 0 END) AS avbokade,
       COUNT(*) AS totalt
     FROM bokningar WHERE ${som} = ?1`, id, nu);

  const tider = await en(env,
    'SELECT COUNT(*) AS antal FROM saljartider WHERE saljare_id = ?1 AND datum >= ?2 AND ledig = 1', id, nu);

  return {
    anvandare: { ...person, rollnamn: ROLLNAMN[person.roll] || person.roll },
    statistik: {
      kommande: nr(rad && rad.kommande),
      genomforda: nr(rad && rad.genomforda),
      avbokade: nr(rad && rad.avbokade),
      totalt: nr(rad && rad.totalt),
      lediga_tider: nr(tider && tider.antal),
    },
  };
};

/** Tar bort ett konto. Bokningar och historik står kvar — de är lagets. */
api['anvandare-ta-bort'] = async (env, request, body, anv) => {
  kraverFormaga(anv, 'skapa_konton');
  const id = txt(body.id, 40);
  if (id === anv.id) throw new Fel('Du kan inte ta bort ditt eget konto');
  const person = await en(env, 'SELECT id, namn, roll FROM anvandare WHERE id = ?1', id);
  if (!person) throw new Fel('Användaren finns inte', 404);
  if (rang(anv.roll) < ROLLER.admin && !BOKARE_PLUS_ROLLER.includes(person.roll)) {
    throw new Fel('Det kontot sköts av en administratör', 403);
  }

  await kor(env, 'DELETE FROM sessioner WHERE anvandare_id = ?1', id);
  await kor(env, 'DELETE FROM saljartider WHERE saljare_id = ?1', id);
  await kor(env, 'DELETE FROM omrade_saljare WHERE anvandare_id = ?1', id);
  await kor(env, 'DELETE FROM anvandare WHERE id = ?1', id);
  await nyhet(env, 'konto', anv.namn + ' tog bort kontot ' + person.namn, { anvandare_id: anv.id });
  return {};
};

/** Tar bort en bokning helt. Avbokning räcker oftast; det här är för misstag. */
api['bokning-ta-bort'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  const bokning = await en(env,
    `SELECT b.*, ad.gata, ad.nummer FROM bokningar b
     LEFT JOIN adresser ad ON ad.id = b.adress_id WHERE b.id = ?1`, id);
  if (!bokning) throw new Fel('Bokningen finns inte', 404);
  if (!(await farRadera(env, anv, bokning))) {
    throw new Fel(far(anv, 'radera_egna') && bokning.anvandare_id === anv.id
      ? 'Mötet har fått ett omdöme och kan inte raderas — avboka det i stället'
      : 'Bara Mötesbokare+ kan radera andras bokningar', 403);
  }

  await kor(env, 'DELETE FROM kommentarer WHERE bokning_id = ?1', id);
  await kor(env, 'DELETE FROM bilagor WHERE bokning_id = ?1', id);
  await kor(env, 'DELETE FROM aterkoppling WHERE bokning_id = ?1', id);
  await kor(env, 'DELETE FROM bokningar WHERE id = ?1', id);
  await nyhet(env, 'avbokning',
    anv.namn + ' tog bort bokningen på ' + kortAdress(bokning) +
    (bokning.datum ? ' ' + bokning.datum + (bokning.tid ? ' kl. ' + bokning.tid : '') : ''),
    { saljare_id: bokning.saljare_id, anvandare_id: anv.id });
  return {};
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
  kraverStatistik(anv);
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
  kraverStatistik(anv);
  const id = txt(body.id, 40) || anv.id;
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
