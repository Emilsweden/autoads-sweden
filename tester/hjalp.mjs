/**
 * Det testerna delar: anrop mot API:t, konton med inloggning, och datum som
 * inte beror på vilken dag testerna körs.
 */

export const LOSENORD = 'losenord123';

/** POST /api/<namn>. Svaret får statuskoden som `kod` bredvid serverns fält. */
export async function anrop(url, namn, data = {}, token) {
  const r = await fetch(url + '/api/' + namn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(token ? { ...data, token } : data),
  });
  return { ...(await r.json()), kod: r.status };
}

/**
 * Ett nytt system med en administratör. Returnerar `som(epost)` för att logga
 * in, och `konto(namn, roll, extra)` för att lägga upp ett konto och få
 * tillbaka { id, token }.
 */
export async function nyttSystem(s) {
  const inst = await anrop(s.url, 'installera', {
    nyckel: 'test-installation', namn: 'Emil Admin', epost: 'admin@vt.test', losenord: LOSENORD,
  });
  if (!inst.ok) throw new Error('Installationen misslyckades: ' + inst.fel);
  const admin = await loggaIn(s, 'admin@vt.test');

  let n = 0;
  async function konto(namn, roll, extra = {}) {
    const epost = namn.toLowerCase().replace(/[^a-z]/g, '') + (++n) + '@vt.test';
    const svar = await anrop(s.url, 'anvandare-spara', { namn, epost, roll, losenord: LOSENORD, ...extra }, admin.token);
    if (!svar.ok) throw new Error(`Kontot ${namn} (${roll}) gick inte att skapa: ${svar.fel}`);
    return { id: svar.id, namn, epost, ...(await loggaIn(s, epost)) };
  }
  return { admin, konto };
}

export async function loggaIn(s, epost, losenord = LOSENORD) {
  const svar = await anrop(s.url, 'logga-in', { epost, losenord });
  if (!svar.ok) throw new Error(`Inloggningen för ${epost} misslyckades: ${svar.fel}`);
  return { token: svar.token, id: svar.anvandare.id, roll: svar.anvandare.roll };
}

/** Nästa datum med veckodagen (0 = söndag … 6 = lördag), minst en dag fram. */
export function nasta(veckodag, efter = new Date()) {
  const d = new Date(Date.UTC(efter.getUTCFullYear(), efter.getUTCMonth(), efter.getUTCDate(), 12));
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== veckodag);
  return d.toISOString().slice(0, 10);
}

/** En dag n dagar efter `datum`. */
export function plus(datum, n) {
  const d = new Date(datum + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Lägger in tider direkt i databasen, förbi alla regler. För att ställa upp
 * lägen servern själv inte skulle släppa igenom — tider utanför arbetstiden,
 * eller en tid som redan passerat.
 */
export function tiderIDatabasen(s, saljareId, datum, tider, ledig = 1) {
  for (const tid of tider) {
    s.db.prepare(
      `INSERT OR REPLACE INTO saljartider (id, saljare_id, datum, tid, ledig, skapad)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(`t-${saljareId}-${datum}-${tid}`, saljareId, datum, tid, ledig);
  }
}
