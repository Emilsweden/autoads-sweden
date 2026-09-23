/**
 * Realtid: pulsen är det appen frågar var tolfte sekund, "har något hänt?".
 * Den ska slå till på allt som ändrar det någon annan ser — också en
 * ändring eller borttagning, inte bara nya rader — men inte när någon bara
 * tittar, för då hämtar alla telefoner om i onödan.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta } from './hjalp.mjs';

const DAG = nasta(5);
const vanta = (ms) => new Promise((r) => setTimeout(r, ms));

describe('realtid', () => {
  let s, admin, bokare, karl, bokning;
  const puls = async () => (await anrop(s.url, 'puls', {}, bokare.token)).senast;

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    bokare = await sys.konto('Bea Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: DAG, tider: ['10:00', '14:00'] }, admin.token);
    bokning = (await anrop(s.url, 'kalender-boka', {
      datum: DAG, tid: '10:00', saljare_id: karl.id, fornamn: 'Eva', telefon: '070', adress: 'Pulsgatan 1, Sala',
    }, bokare.token)).bokning;
  });
  after(() => s.stang());

  it('en ändrad kund slår an pulsen', async () => {
    const fore = await puls();
    await vanta(5);
    assert.equal((await anrop(s.url, 'bokning-andra', { id: bokning.id, fornamn: 'Eva Ek' }, bokare.token)).kod, 200);
    assert.ok(await puls() > fore);
  });

  it('en borttagen tid slår an pulsen', async () => {
    const fore = await puls();
    await vanta(5);
    const r = await anrop(s.url, 'saljartid-andra', { saljare_id: karl.id, datum: DAG, tider: ['14:00'], lage: 'ta_bort' }, admin.token);
    assert.equal(r.kod, 200, r.fel);
    assert.ok(await puls() > fore);
  });

  it('att bara titta slår inte an pulsen', async () => {
    const fore = await puls();
    await vanta(5);
    await anrop(s.url, 'bokningar', { fran: DAG, till: DAG }, bokare.token);
    await anrop(s.url, 'kalender', { fran: DAG, till: DAG }, bokare.token);
    await anrop(s.url, 'lediga-dagar', {}, bokare.token);
    await anrop(s.url, 'nyheter', {}, bokare.token);
    assert.equal(await puls(), fore);
  });

  it('ett nekat anrop slår inte an pulsen', async () => {
    const fore = await puls();
    await vanta(5);
    assert.equal((await anrop(s.url, 'bokning-ta-bort', { id: bokning.id }, karl.token)).kod, 403);
    assert.equal(await puls(), fore);
  });

  it('samma registrering två gånger — dubbeltryck eller kön som skickar om — blir en bokning', async () => {
    const dorr = (await anrop(s.url, 'adress-ny', { gata: 'Dubbelgatan', nummer: '2', postort: 'Sala' }, bokare.token)).adress;
    const data = {
      adress_id: dorr.id, resultat: 'bokat', fornamn: 'Två', telefon: '070', datum: DAG, tid: '14:00',
      saljare_id: karl.id, klient_id: 'telefon-123-abc',
    };
    await anrop(s.url, 'saljartid-andra', { saljare_id: karl.id, datum: DAG, tider: ['14:00'], lage: 'lagg_till' }, admin.token);
    const [a, b] = await Promise.all([anrop(s.url, 'handelse', data, bokare.token), anrop(s.url, 'handelse', data, bokare.token)]);
    assert.equal(a.kod, 200, a.fel);
    assert.equal(b.kod, 200, b.fel);
    assert.equal(a.bokning.id, b.bokning.id);
    assert.equal(s.sql(`SELECT COUNT(*) AS n FROM bokningar WHERE fornamn = 'Två'`)[0].n, 1);
    assert.equal(s.sql(`SELECT COUNT(*) AS n FROM handelser WHERE klient_id = 'telefon-123-abc'`)[0].n, 1);
  });

  it('ett besök ur kön får tiden det gjordes, inte tiden det skickades', async () => {
    const dorr = (await anrop(s.url, 'adress-ny', { gata: 'Kögatan', nummer: '1', postort: 'Sala' }, bokare.token)).adress;
    const tvaTimmarSedan = Date.now() - 2 * 3600e3;
    await anrop(s.url, 'handelse', { adress_id: dorr.id, resultat: 'nej', ko_tid: tvaTimmarSedan, bekrafta: true }, bokare.token);
    assert.equal(s.sql('SELECT skapad FROM handelser WHERE adress_id = ?', dorr.id)[0].skapad, tvaTimmarSedan);
    // En klocka som går fel i telefonen får inte skriva historia hur långt bak som helst.
    const dorr2 = (await anrop(s.url, 'adress-ny', { gata: 'Kögatan', nummer: '3', postort: 'Sala' }, bokare.token)).adress;
    await anrop(s.url, 'handelse', { adress_id: dorr2.id, resultat: 'nej', ko_tid: Date.now() - 90 * 86400e3, bekrafta: true }, bokare.token);
    assert.ok(s.sql('SELECT skapad FROM handelser WHERE adress_id = ?', dorr2.id)[0].skapad > Date.now() - 8 * 86400e3);
  });
});
