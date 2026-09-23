/**
 * Dörrarna på kartan: tre utfall, och radering direkt från markören.
 *
 *   Bokat, Nej, Inget svar — Återkom finns inte längre och räknas som Inget svar
 *   Nej och Inget svar sparas med ett tryck, utan följdfrågor
 *   Radera: Mötesbokare+ alla dörrar, mötesbokaren dörrar bara han besökt.
 *   Historiken finns kvar — skapas adressen igen kommer den tillbaka.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta } from './hjalp.mjs';

describe('markörerna', () => {
  let s, admin, plusBokare, bea, olle, karl, alma, omrade;
  const ny = async (vem, gata, nummer = '1') =>
    (await anrop(s.url, 'adress-ny', { gata, nummer, postort: 'Sala', omrade_id: omrade }, vem.token)).adress;
  const pakarta = async (vem, id) =>
    (await anrop(s.url, 'adresser', {}, vem.token)).adresser.some((a) => a.id === id);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    bea = await sys.konto('Bea Bokare', 'saljare');
    olle = await sys.konto('Olle Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    alma = await sys.konto('Alma Admin', 'saljadmin');
    omrade = (await anrop(s.url, 'omrade-spara', { namn: 'Sala', ort: 'Sala' }, admin.token)).id;
  });
  after(() => s.stang());

  it('Nej och Inget svar sparas med ett tryck, utan orsak', async () => {
    const a = await ny(bea, 'Ettrycksvägen');
    assert.equal((await anrop(s.url, 'handelse', { adress_id: a.id, resultat: 'nej' }, bea.token)).kod, 200);
    const b = await ny(bea, 'Ettrycksvägen', '2');
    assert.equal((await anrop(s.url, 'handelse', { adress_id: b.id, resultat: 'ejsvar' }, bea.token)).kod, 200);
    assert.deepEqual(s.sql('SELECT status FROM adresser WHERE id IN (?, ?) ORDER BY nummer', a.id, b.id).map((r) => r.status),
      ['nej', 'ejsvar']);
  });

  it('Återkom från en äldre telefon blir Inget svar', async () => {
    const a = await ny(bea, 'Gamlagatan');
    const r = await anrop(s.url, 'handelse', { adress_id: a.id, resultat: 'aterkom', aterkom_datum: nasta(3) }, bea.token);
    assert.equal(r.kod, 200, r.fel);
    assert.equal(s.sql('SELECT status FROM adresser WHERE id = ?', a.id)[0].status, 'ejsvar');
  });

  it('uppsättningen flyttar gamla Återkom till Inget svar och låter historiken vara', () => {
    const a = s.sql(`SELECT id FROM adresser WHERE gata = 'Gamlagatan'`)[0];
    s.db.prepare(`UPDATE adresser SET status = 'aterkom' WHERE id = ?`).run(a.id);
    s.db.prepare(`INSERT INTO handelser (id, adress_id, anvandare_id, resultat, skapad) VALUES ('gammal', ?, ?, 'aterkom', 1)`)
      .run(a.id, bea.id);
    const workflow = readFileSync(new URL('../.github/workflows/satt-upp-faltsystemet.yml', import.meta.url), 'utf8');
    const flytt = workflow.match(/UPDATE adresser SET status = 'ejsvar' WHERE status = 'aterkom';/);
    assert.ok(flytt, 'flytten saknas i uppsättningen');
    s.db.exec(flytt[0]);
    s.db.exec(flytt[0]);
    assert.equal(s.sql('SELECT status FROM adresser WHERE id = ?', a.id)[0].status, 'ejsvar');
    assert.equal(s.sql(`SELECT resultat FROM handelser WHERE id = 'gammal'`)[0].resultat, 'aterkom');
  });

  it('Mötesbokare+ raderar en dörr med historik; den försvinner från kartan men historiken finns kvar', async () => {
    const a = await ny(bea, 'Raderavägen');
    await anrop(s.url, 'handelse', { adress_id: a.id, resultat: 'nej' }, bea.token);
    const dorr = await anrop(s.url, 'adress', { id: a.id }, plusBokare.token);
    assert.equal(dorr.far_radera, true);
    const r = await anrop(s.url, 'adress-ta-bort', { id: a.id }, plusBokare.token);
    assert.equal(r.kod, 200, r.fel);
    assert.equal(await pakarta(plusBokare, a.id), false);
    assert.equal(s.sql('SELECT COUNT(*) AS n FROM handelser WHERE adress_id = ?', a.id)[0].n, 1);

    // Samma adress igen: dörren kommer tillbaka med sin historik.
    const igen = await ny(olle, 'Raderavägen');
    assert.equal(igen.id, a.id);
    assert.equal(await pakarta(plusBokare, a.id), true);
    assert.equal(igen.antal_besok, 1);
  });

  it('en dörr utan historik raderas helt', async () => {
    const a = await ny(plusBokare, 'Tomvägen');
    assert.equal((await anrop(s.url, 'adress-ta-bort', { id: a.id }, plusBokare.token)).kod, 200);
    assert.equal(s.sql('SELECT COUNT(*) AS n FROM adresser WHERE id = ?', a.id)[0].n, 0);
  });

  it('mötesbokaren raderar dörrar bara han besökt — inte någon annans', async () => {
    const egen = await ny(bea, 'Beasväg');
    await anrop(s.url, 'handelse', { adress_id: egen.id, resultat: 'ejsvar' }, bea.token);
    const annans = await ny(olle, 'Ollesväg');
    await anrop(s.url, 'handelse', { adress_id: annans.id, resultat: 'nej' }, olle.token);
    assert.equal((await anrop(s.url, 'adress', { id: annans.id }, bea.token)).far_radera, false);
    assert.equal((await anrop(s.url, 'adress-ta-bort', { id: annans.id }, bea.token)).kod, 403);
    assert.equal((await anrop(s.url, 'adress-ta-bort', { id: egen.id }, bea.token)).kod, 200);
    assert.equal(await pakarta(bea, egen.id), false);
  });

  it('besiktare och Admin Besiktare raderar inga dörrar', async () => {
    const a = await ny(bea, 'Skyddadväg');
    assert.equal((await anrop(s.url, 'adress-ta-bort', { id: a.id }, karl.token)).kod, 403);
    assert.equal((await anrop(s.url, 'adress-ta-bort', { id: a.id }, alma.token)).kod, 403);
  });

  it('en dörr med ett kommande möte raderas inte — bokningen måste bort först', async () => {
    const dag = nasta(2);
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: dag, tider: ['10:00'] }, admin.token);
    const bok = await anrop(s.url, 'kalender-boka', {
      datum: dag, tid: '10:00', saljare_id: karl.id, fornamn: 'Kvar', telefon: '070', adress: 'Mötesvägen 1, Sala',
    }, plusBokare.token);
    const [a] = s.sql(`SELECT id FROM adresser WHERE gata = 'Mötesvägen'`);
    const r = await anrop(s.url, 'adress-ta-bort', { id: a.id }, plusBokare.token);
    assert.equal(r.kod, 409);
    assert.match(r.fel, /möte/);
    assert.ok(bok.bokning.id);
  });

  it('ett besök på en dörr som just raderats tar tillbaka den — besöket hamnar inte på en osynlig dörr', async () => {
    const a = await ny(bea, 'Återvägen');
    await anrop(s.url, 'handelse', { adress_id: a.id, resultat: 'nej' }, bea.token);
    await anrop(s.url, 'adress-ta-bort', { id: a.id }, plusBokare.token);
    assert.equal(await pakarta(olle, a.id), false);
    // Olle hade dörren öppen sedan innan och trycker Inget svar.
    const r = await anrop(s.url, 'handelse', { adress_id: a.id, resultat: 'ejsvar', bekrafta: true }, olle.token);
    assert.equal(r.kod, 200, r.fel);
    assert.equal(await pakarta(olle, a.id), true);
  });
});
