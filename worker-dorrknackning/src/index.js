/**
 * Delad dörrknackningslista — Cloudflare Worker + D1.
 *
 * Ett enda endpoint, POST /sync, som både tar emot ändringar från en telefon
 * och skickar tillbaka det som andra telefoner ändrat sedan förra gången.
 * Appen fungerar offline och synkar när den får täckning igen.
 *
 * Auth: Authorization: Bearer <TEAM_KEY>  (secret, samma för hela säljteamet)
 */

const ALLOWED_ORIGINS = [
  'https://autoads.se',
  'https://www.autoads.se',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const MAX_POSTER_PER_SYNC = 500;
const TOMBSTONE_DAGAR = 90;

/* ── Hjälpare ── */

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Jämförelse som tar lika lång tid oavsett var nycklarna skiljer sig. */
function sameSecret(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a || ''));
  const y = enc.encode(String(b || ''));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function int(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Plockar ut och begränsar de fält vi litar på från en inskickad post. */
function tvatta(p, nu) {
  const id = str(p && p.id, 64);
  const adress = str(p && p.adress, 300);
  if (!id || !adress) return null;
  return {
    id,
    adress,
    namn: str(p.namn, 120),
    telefon: str(p.telefon, 40),
    status: ['bokad', 'ejsvar', 'fundera', 'nej'].includes(p.status) ? p.status : 'bokad',
    datum: /^\d{4}-\d{2}-\d{2}$/.test(p.datum || '') ? p.datum : null,
    tid: /^\d{2}:\d{2}$/.test(p.tid || '') ? p.tid : null,
    anteckning: str(p.not, 2000),
    besok: Math.min(Math.max(int(p.besok, 1), 1), 999),
    klar: p.klar ? 1 : 0,
    borttagen: p.borttagen ? 1 : 0,
    saljare: str(p.saljare, 60),
    skapad: int(p.skapad, nu),
    uppdaterad: int(p.uppdaterad, nu),
  };
}

/** Databasrad → samma form som appen använder. */
function tillApp(rad) {
  return {
    id: rad.id,
    adress: rad.adress,
    namn: rad.namn || '',
    telefon: rad.telefon || '',
    status: rad.status || 'bokad',
    datum: rad.datum || '',
    tid: rad.tid || '',
    not: rad.anteckning || '',
    besok: rad.besok || 1,
    klar: !!rad.klar,
    borttagen: !!rad.borttagen,
    saljare: rad.saljare || '',
    skapad: rad.skapad || 0,
    uppdaterad: rad.uppdaterad || 0,
  };
}

const UPSERT = `
INSERT INTO poster
  (id, adress, namn, telefon, status, datum, tid, anteckning,
   besok, klar, borttagen, saljare, skapad, uppdaterad, server_tid)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
ON CONFLICT(id) DO UPDATE SET
  adress = excluded.adress,
  namn = excluded.namn,
  telefon = excluded.telefon,
  status = excluded.status,
  datum = excluded.datum,
  tid = excluded.tid,
  anteckning = excluded.anteckning,
  besok = MAX(excluded.besok, poster.besok),
  klar = excluded.klar,
  borttagen = excluded.borttagen,
  saljare = excluded.saljare,
  uppdaterad = excluded.uppdaterad,
  server_tid = excluded.server_tid
WHERE excluded.uppdaterad > poster.uppdaterad`;

/* ── Worker ── */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/halsa') {
      return json(request, { ok: true, tjanst: 'autoads-dorrknackning' });
    }

    if (request.method !== 'POST' || url.pathname !== '/sync') {
      return json(request, { ok: false, fel: 'Okänd endpoint' }, 404);
    }

    if (!env.TEAM_KEY) {
      return json(request, { ok: false, fel: 'Servern saknar TEAM_KEY' }, 500);
    }

    const auth = request.headers.get('Authorization') || '';
    const nyckel = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!sameSecret(nyckel, env.TEAM_KEY)) {
      return json(request, { ok: false, fel: 'Fel teamnyckel' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(request, { ok: false, fel: 'Trasig JSON' }, 400);
    }

    const nu = Date.now();
    const since = Math.max(0, int(body && body.since, 0));
    const inkomna = Array.isArray(body && body.poster) ? body.poster : [];

    if (inkomna.length > MAX_POSTER_PER_SYNC) {
      return json(request, { ok: false, fel: 'För många poster i en synk' }, 413);
    }

    try {
      // 1. Skriv in det telefonen ändrat. Nyast ändring vinner.
      const satser = [];
      for (const p of inkomna) {
        const r = tvatta(p, nu);
        if (!r) continue;
        satser.push(
          env.DB.prepare(UPSERT).bind(
            r.id, r.adress, r.namn, r.telefon, r.status, r.datum, r.tid, r.anteckning,
            r.besok, r.klar, r.borttagen, r.saljare, r.skapad, r.uppdaterad, nu
          )
        );
      }
      if (satser.length) await env.DB.batch(satser);

      // 2. Skicka tillbaka allt som ändrats sedan telefonens förra synk.
      const { results } = await env.DB
        .prepare('SELECT * FROM poster WHERE server_tid >= ?1 ORDER BY server_tid LIMIT 1000')
        .bind(since)
        .all();

      // 3. Städa bort gamla raderingar då och då.
      if (Math.random() < 0.02) {
        await env.DB
          .prepare('DELETE FROM poster WHERE borttagen = 1 AND server_tid < ?1')
          .bind(nu - TOMBSTONE_DAGAR * 86400000)
          .run();
      }

      return json(request, {
        ok: true,
        nu,
        mottagna: satser.length,
        poster: (results || []).map(tillApp),
      });
    } catch (err) {
      console.error('Sync misslyckades:', err && err.message);
      return json(request, { ok: false, fel: 'Databasfel' }, 500);
    }
  },
};
