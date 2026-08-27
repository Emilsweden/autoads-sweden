/**
 * Autoads Fältsystem — API för dörrknackning, områdeskontroll och
 * bokning av takbesiktningar.
 *
 * Cloudflare Worker + D1. Alla anrop är POST /api/<namn> med JSON-body.
 * Inloggning sker med e-post och lösenord, därefter skickas sessionstoken
 * som "Authorization: Bearer <token>".
 */

const RESULTAT = ['bokat', 'ejsvar', 'nej', 'aterkom'];
const ROLLER = { saljare: 1, teamleader: 2, admin: 3 };
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

function kraver(anv, roll) {
  if (ROLLER[anv.roll] < ROLLER[roll]) throw new Fel('Du har inte behörighet till detta', 403);
}

/** Områden användaren får se: tilldelade områden, plus otilldelade. Admin ser allt. */
async function synligaOmraden(env, anv) {
  if (ROLLER[anv.roll] >= ROLLER.teamleader) {
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

  return { token, anvandare: { id: anv.id, namn: anv.namn, epost: anv.epost, roll: anv.roll, team: anv.team } };
};

api['logga-ut'] = async (env, request, body) => {
  const token = tokenFran(request, body);
  if (token) await kor(env, 'DELETE FROM sessioner WHERE token = ?1', token);
  return {};
};

api['jag'] = async (env, request, body, anv) => ({
  anvandare: { id: anv.id, namn: anv.namn, epost: anv.epost, roll: anv.roll, team: anv.team },
  installningar: await installningar(env),
  omraden: await synligaOmraden(env, anv),
});

api['byt-losenord'] = async (env, request, body, anv) => {
  const nytt = String(body.nytt || '');
  if (nytt.length < 8) throw new Fel('Lösenordet måste vara minst 8 tecken');
  const gammalt = await hasha(String(body.gammalt || ''), anv.salt);
  if (!lika(gammalt, anv.hash)) throw new Fel('Fel nuvarande lösenord', 401);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await kor(env, 'UPDATE anvandare SET hash = ?1, salt = ?2 WHERE id = ?3', await hasha(nytt, salt), salt, anv.id);
  return {};
};

/* ── Användare (admin) ── */

api['anvandare-lista'] = async (env, request, body, anv) => {
  kraver(anv, 'teamleader');
  return {
    anvandare: await alla(env,
      'SELECT id, namn, epost, roll, team, aktiv, skapad FROM anvandare ORDER BY roll DESC, namn'),
  };
};

api['anvandare-spara'] = async (env, request, body, anv) => {
  kraver(anv, 'admin');
  const namn = txt(body.namn, 80);
  const epost = (txt(body.epost, 160) || '').toLowerCase();
  const roll = ROLLER[body.roll] ? body.roll : 'saljare';
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
  const id = txt(body.id, 40);
  const adress = await en(env,
    `SELECT a.*, u.namn AS senast_namn FROM adresser a
     LEFT JOIN anvandare u ON u.id = a.senast_av WHERE a.id = ?1`, id);
  if (!adress) throw new Fel('Adressen finns inte', 404);

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
  const adressId = txt(body.adress_id, 40);
  const resultat = RESULTAT.includes(body.resultat) ? body.resultat : null;
  if (!adressId || !resultat) throw new Fel('Adress och resultat krävs');

  const adress = await en(env, 'SELECT * FROM adresser WHERE id = ?1', adressId);
  if (!adress) throw new Fel('Adressen finns inte', 404);

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
    await kor(env,
      `INSERT INTO bokningar
         (id,adress_id,handelse_id,anvandare_id,fornamn,efternamn,telefon,datum,tid,kommentar,status,skapad)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'bokad',?11)`,
      bokningId, adressId, handelseId, anv.id,
      txt(body.fornamn, 80), txt(body.efternamn, 80), txt(body.telefon, 40),
      datum(body.datum), klockslag(body.tid), txt(body.kommentar, 1000), nu);
    bokning = { id: bokningId };
  }

  return { handelse_id: handelseId, bokning, status };
};

/**
 * Skapar en adress på plats när säljaren står vid en dörr som inte finns i
 * området — t.ex. en manuell bokning. Finns adressen redan återanvänds den,
 * så att historiken hänger ihop och inga dubbletter uppstår.
 */
api['adress-ny'] = async (env, request, body, anv) => {
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

  if (datum(body.fran)) lagg('b.datum >= ?', body.fran);
  if (datum(body.till)) lagg('b.datum <= ?', body.till);
  if (txt(body.saljare_id, 40)) lagg('b.anvandare_id = ?', txt(body.saljare_id, 40));
  if (txt(body.status, 20)) lagg('b.status = ?', txt(body.status, 20));
  if (txt(body.omrade_id, 40)) lagg('ad.omrade_id = ?', txt(body.omrade_id, 40));

  const rader = await alla(env,
    `SELECT b.*, u.namn AS saljare, ad.gata, ad.nummer, ad.omrade_id, o.namn AS omrade
     FROM bokningar b
     LEFT JOIN anvandare u ON u.id = b.anvandare_id
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

api['bokning-status'] = async (env, request, body, anv) => {
  const id = txt(body.id, 40);
  const status = ['bokad', 'genomford', 'avbokad'].includes(body.status) ? body.status : null;
  if (!id || !status) throw new Fel('Bokning och status krävs');
  const bokning = await en(env, 'SELECT * FROM bokningar WHERE id = ?1', id);
  if (!bokning) throw new Fel('Bokningen finns inte', 404);
  if (bokning.anvandare_id !== anv.id) kraver(anv, 'teamleader');
  await kor(env, 'UPDATE bokningar SET status = ?1 WHERE id = ?2', status, id);
  return {};
};

/* ── Position ── */

api['position'] = async (env, request, body, anv) => {
  const lat = nr(body.lat, null), lon = nr(body.lon, null);
  if (lat === null || lon === null) throw new Fel('Position saknas');
  await kor(env,
    `INSERT INTO positioner (anvandare_id,lat,lon,uppdaterad) VALUES (?1,?2,?3,?4)
     ON CONFLICT(anvandare_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, uppdaterad=excluded.uppdaterad`,
    anv.id, lat, lon, Date.now());
  return {};
};

api['positioner'] = async (env, request, body, anv) => {
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
