/**
 * Fältsystemet på den egna datorn: workern, databasen och appen i en process.
 *
 * Workern körs som den är — samma fil som publiceras — med en databas i minnet
 * i stället för Cloudflare D1. Appen serveras från samma adress, precis som
 * [assets] gör i produktion, så appen och servern pratar med varandra utan att
 * något behöver pekas om.
 *
 *   node --disable-warning=ExperimentalWarning tester/server.mjs
 *
 * startar på http://localhost:8787. Första administratören skapas med
 * installationsnyckeln "test-installation" (se tester/hjalp.mjs, installera()).
 *
 * Testerna importerar starta() och får en egen server på en ledig port, med
 * databasen och de utgående mejlen åtkomliga direkt.
 */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../worker-falt/src/index.js';

const ROT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPEN = join(ROT, 'falt');

/**
 * Indexen som uppsättningen lägger på efter schema.sql. De ligger inte i
 * schemat (se kommentaren där), så de måste läggas på här också — annars
 * testas en databas utan dubbelbokningsskyddet. Test "workflow och testserver
 * lägger på samma skydd" larmar om de två glider isär.
 */
export const EFTER_SCHEMAT = [
  'CREATE INDEX IF NOT EXISTS idx_bok_saljare ON bokningar(saljare_id, datum);',
  'DROP INDEX IF EXISTS idx_bok_slot;',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bok_saljarslot ON bokningar(datum, tid, saljare_id)
                 WHERE tid IS NOT NULL AND tid <> '' AND saljare_id IS NOT NULL AND status <> 'avbokad';`,
];

/**
 * D1:s gränssnitt ovanpå node:sqlite. Bara det workern använder:
 * prepare().bind().all() / .first() / .run(), och batch().
 */
/**
 * D1 ligger över nätet: varje fråga är en väntan, och under den hinner andra
 * förfrågningar köra. Utan den här turen körde testservern varje förfrågan
 * klart innan nästa började, och ett test av två samtidiga bokningar prövade
 * aldrig att de faktiskt krockade.
 */
const tur = () => new Promise((klar) => setImmediate(klar));

function d1(db) {
  const varde = (v, i, sql) => {
    // D1 vägrar undefined. Gör samma sak här, så att ett glömt fält syns i
    // testet i stället för att bli NULL.
    if (v === undefined) throw new Error(`D1_TYPE_ERROR: undefined i parameter ${i + 1} — ${sql.slice(0, 80)}`);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  };
  return {
    prepare(sql) {
      const bunden = (args) => {
        const stmt = db.prepare(sql);
        const p = args.map((v, i) => varde(v, i, sql));
        // batch() kör satserna direkt efter varandra utan await emellan —
        // precis som D1, där ingen annan förfrågan kommer in mitt i en batch.
        const kor = () => {
          if (stmt.columns().length) return { results: stmt.all(...p), success: true, meta: { changes: 0 } };
          const r = stmt.run(...p);
          return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        };
        return {
          _kor: kor,
          async all() { await tur(); return { results: stmt.all(...p), success: true, meta: {} }; },
          async first() { await tur(); return stmt.get(...p) ?? null; },
          async run() {
            await tur();
            const r = stmt.run(...p);
            return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
          },
        };
      };
      return { bind: (...args) => bunden(args), ...bunden([]) };
    },
    /** Alla eller inga: går en sats fel rullas hela batchen tillbaka, som i D1. */
    async batch(satser) {
      await tur();
      db.exec('BEGIN');
      try {
        const ut = satser.map((s) => s._kor());
        db.exec('COMMIT');
        return ut;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const TYPER = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

/** En fil ur falt/ om sökvägen pekar på en, annars null — som [assets]. */
function tillgang(sokvag) {
  const rel = decodeURIComponent(sokvag).replace(/^\/+/, '') || 'index.html';
  const fil = normalize(join(APPEN, rel));
  if (fil !== APPEN && !fil.startsWith(APPEN + sep)) return null;
  try {
    const st = statSync(fil);
    if (st.isDirectory()) return tillgang(join(sokvag, 'index.html'));
    return st.isFile() ? fil : null;
  } catch { return null; }
}

/**
 * Startar en server. port 0 = en ledig port (testerna); 8787 när filen körs
 * direkt. Returnerar adressen, databasen, mejlen workern skickat, och stang().
 */
export async function starta({ port = 0, tyst = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(ROT, 'worker-falt/schema.sql'), 'utf8'));
  for (const sql of EFTER_SCHEMAT) db.exec(sql);

  const brevlada = [];
  let bas = '';                // serverns egen adress, känd först när porten är vald
  const env = {
    DB: d1(db),
    INSTALL_NYCKEL: 'test-installation',
    EPOST_NYCKEL: 'test-nyckel',
    EPOST_AVSANDARE: 'test@villatak.test',
    EPOST_URL: '',             // sätts till bas + '/__epost' när porten är vald
  };

  // Workern loggar serverfel med console.error. I testerna är de väntade
  // ibland (en 500 som ska bli en 403 är just det testet fångar), så de
  // samlas i stället för att skräpa ned utskriften.
  const loggar = [];
  const serverfel = console.error;
  if (tyst) console.error = (...a) => loggar.push(a.join(' '));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, bas);

      // Mejltjänsten: workern skickar hit i stället för till Resend.
      if (req.method === 'POST' && url.pathname === '/__epost') {
        let text = '';
        for await (const bit of req) text += bit;
        brevlada.push(JSON.parse(text));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"test"}');
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        const fil = tillgang(url.pathname);
        if (fil) {
          let innehall = readFileSync(fil);
          // Appen ska prata med den här servern, inte med produktionen.
          // Skrivs om när filen serveras — filen på disk rörs aldrig.
          if (fil === join(APPEN, 'config.js')) {
            innehall = innehall.toString('utf8')
              .replace(/STANDARD_SERVER = '[^']*'/, `STANDARD_SERVER = '${bas}'`);
          }
          res.writeHead(200, {
            'Content-Type': TYPER[extname(fil)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
          });
          res.end(req.method === 'HEAD' ? undefined : innehall);
          return;
        }
      }

      let kropp;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const bitar = [];
        for await (const bit of req) bitar.push(bit);
        kropp = Buffer.concat(bitar);
      }
      const svar = await worker.fetch(new Request(url.href, {
        method: req.method, headers: req.headers, body: kropp,
      }), env);
      const huvud = {};
      svar.headers.forEach((v, k) => { huvud[k] = v; });
      res.writeHead(svar.status, huvud).end(Buffer.from(await svar.arrayBuffer()));
    } catch (e) {
      loggar.push('TESTSERVER: ' + (e && e.stack || e));
      res.writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: false, fel: 'Testserverfel: ' + (e && e.message) }));
    }
  });

  await new Promise((klar) => server.listen(port, '127.0.0.1', klar));
  bas = `http://127.0.0.1:${server.address().port}`;
  env.EPOST_URL = bas + '/__epost';

  return {
    url: bas,
    db,
    brevlada,
    loggar,
    /** Kör SQL direkt mot databasen — för att ställa upp lägen och kontrollera dem. */
    sql: (fraga, ...args) => db.prepare(fraga).all(...args),
    async stang() {
      console.error = serverfel;
      await new Promise((klar) => server.close(klar));
      db.close();
    },
  };
}

// Körs filen direkt: starta på 8787 och låt den stå.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT) || 8787;
  const s = await starta({ port, tyst: false });
  console.log(`Fältsystemet kör på ${s.url}  (databas i minnet — försvinner när du stänger)`);
  console.log('Första administratören: installera med nyckeln "test-installation".');
}
