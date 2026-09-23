/**
 * Reglerna för när en besiktare går att boka. De gäller överallt — i listan
 * över lediga dagar, i tiderna, i kalendern, och när bokningen skrivs — så
 * varje scenario prövas både på det som erbjuds och på det som sparas.
 *
 *   A  max 2 om dagen, tider 09/12/15/18: två bokade → dagen är full
 *   B  en bokning tas bort → tiden går att boka igen
 *   C  en bokning flyttas 12 → 15 med samma id
 *   D  max 3 → exakt tre
 *   E  två besiktare på samma klockslag påverkar inte varandra
 *   F  arbetstid 12–20 → 09–11 syns inte
 *   minst tre timmar mellan två möten hos samma besiktare
 *   blockerade tider erbjuds inte
 *   tiden först: "17:00 passar" → dagarna och besiktarna
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta, plus, tiderIDatabasen } from './hjalp.mjs';

const START = nasta(1);            // en måndag, minst en dag fram
const dag = (n) => plus(START, n); // var sitt datum per scenario, så de inte stör varandra

describe('bokningsreglerna', () => {
  let s, admin, plusBokare, bokare, alma, max, karl, nils, lisa;

  const boka = (vem, data) => anrop(s.url, 'kalender-boka', {
    fornamn: 'Kund', telefon: '070-000', adress: `Regelgatan ${Math.floor(Math.random() * 1e6)}, Sala`, ...data,
  }, vem.token);
  const tider = (vem, datum, lista) =>
    anrop(s.url, 'saljartider-spara', { saljare_id: vem.id, datum, tider: lista }, admin.token);
  /** Tiderna besiktaren kan bokas på en dag, enligt servern. */
  const bokbara = async (vem, datum) => {
    const r = await anrop(s.url, 'bokbara-tider', { datum }, bokare.token);
    assert.equal(r.kod, 200, r.fel);
    return r.tider.filter((t) => t.besiktare.some((b) => b.id === vem.id)).map((t) => t.tid);
  };
  const erbjudnaDagar = async (fran, till) =>
    (await anrop(s.url, 'lediga-dagar', { fran, till }, bokare.token)).dagar.map((d) => d.datum);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    bokare = await sys.konto('Bea Bokare', 'saljare');
    alma = await sys.konto('Alma Admin', 'saljadmin');
    max = await sys.konto('Max Besiktare', 'besiktare', { max_per_dag: 2 });
    karl = await sys.konto('Karl Besiktare', 'besiktare', { max_per_dag: 3 });
    nils = await sys.konto('Nils Besiktare', 'besiktare');
    lisa = await sys.konto('Lisa Besiktare', 'besiktare', { arbetstid_fran: '12:00', arbetstid_till: '20:00' });
  });
  after(() => s.stang());

  it('A: max 2 och tiderna 09, 12, 15, 18 — två bokade gör dagen full överallt', async () => {
    const d = dag(0);
    assert.equal((await tider(max, d, ['09:00', '12:00', '15:00', '18:00'])).kod, 200);
    assert.deepEqual(await bokbara(max, d), ['09:00', '12:00', '15:00', '18:00']);

    for (const tid of ['09:00', '12:00']) {
      const r = await boka(bokare, { datum: d, tid, saljare_id: max.id });
      assert.equal(r.kod, 200, r.fel);
    }
    assert.deepEqual(await bokbara(max, d), []);
    assert.ok(!(await erbjudnaDagar(d, d)).includes(d), 'dagen erbjuds fast Max är full');
    const kal = await anrop(s.url, 'kalender', { fran: d, till: d }, bokare.token);
    assert.ok(!kal.tider.some((t) => t.saljare_id === max.id), 'kalendern erbjuder en tid hos Max');

    const tredje = await boka(bokare, { datum: d, tid: '15:00', saljare_id: max.id });
    assert.equal(tredje.kod, 409);
    assert.match(tredje.fel, /fullt/);
  });

  it('B: tas bokningen 09 bort går tiden att boka igen', async () => {
    const d = dag(0);
    const [b09] = s.sql(`SELECT id FROM bokningar WHERE saljare_id = ? AND datum = ? AND tid = '09:00'`, max.id, d);
    const r = await anrop(s.url, 'bokning-status', { id: b09.id, status: 'avbokad' }, bokare.token);
    assert.equal(r.kod, 200, r.fel);
    assert.ok((await bokbara(max, d)).includes('09:00'));
    assert.ok((await erbjudnaDagar(d, d)).includes(d));
  });

  it('C: flytt 12 → 15 behåller bokningens id och frigör 12', async () => {
    const d = dag(0);
    const [b12] = s.sql(`SELECT id FROM bokningar WHERE saljare_id = ? AND datum = ? AND tid = '12:00'`, max.id, d);
    const r = await anrop(s.url, 'bokning-andra', { id: b12.id, tid: '15:00' }, bokare.token);
    assert.equal(r.kod, 200, r.fel);
    assert.equal(r.bokning.id, b12.id);
    const rader = s.sql(`SELECT id, tid FROM bokningar WHERE saljare_id = ? AND datum = ? AND status <> 'avbokad'`, max.id, d);
    assert.deepEqual(rader.map((r) => ({ ...r })), [{ id: b12.id, tid: '15:00' }]);
    const fria = await bokbara(max, d);
    assert.ok(fria.includes('12:00'), '12 blev inte ledig');
    assert.ok(!fria.includes('15:00'), '15 erbjuds fast den är tagen');
  });

  it('en flytt som bryter mot reglerna nekas och bokningen står kvar', async () => {
    const d = dag(0);
    await boka(bokare, { datum: d, tid: '09:00', saljare_id: max.id });
    tiderIDatabasen(s, max.id, d, ['11:00']);
    const [b15] = s.sql(`SELECT id FROM bokningar WHERE saljare_id = ? AND datum = ? AND tid = '15:00'`, max.id, d);
    const r = await anrop(s.url, 'bokning-andra', { id: b15.id, tid: '11:00' }, bokare.token);
    assert.equal(r.kod, 409);
    assert.match(r.fel, /3 timmar/);
    assert.equal(s.sql('SELECT tid FROM bokningar WHERE id = ?', b15.id)[0].tid, '15:00');
  });

  it('D: max 3 ger exakt tre möten', async () => {
    const d = dag(1);
    await tider(karl, d, ['09:00', '12:00', '15:00', '18:00']);
    for (const tid of ['09:00', '12:00', '15:00']) {
      const r = await boka(bokare, { datum: d, tid, saljare_id: karl.id });
      assert.equal(r.kod, 200, r.fel);
    }
    const fjarde = await boka(bokare, { datum: d, tid: '18:00', saljare_id: karl.id });
    assert.equal(fjarde.kod, 409);
    assert.match(fjarde.fel, /fullt/);
  });

  it('E: två besiktare kl. 13:00 påverkar inte varandra', async () => {
    const d = dag(2);
    await tider(karl, d, ['13:00']);
    await tider(nils, d, ['13:00']);
    assert.equal((await boka(bokare, { datum: d, tid: '13:00', saljare_id: karl.id })).kod, 200);
    assert.deepEqual(await bokbara(nils, d), ['13:00']);
    assert.equal((await boka(bokare, { datum: d, tid: '13:00', saljare_id: nils.id })).kod, 200);
  });

  it('F: arbetstid 12–20 döljer 09–11, och tider utanför går inte att lägga in', async () => {
    const d = dag(3);
    tiderIDatabasen(s, lisa.id, d, ['09:00', '10:00', '11:00', '12:00', '15:00']);
    assert.deepEqual(await bokbara(lisa, d), ['12:00', '15:00']);
    const utanfor = await boka(bokare, { datum: d, tid: '09:00', saljare_id: lisa.id });
    assert.equal(utanfor.kod, 409);

    const r = await tider(lisa, d, ['09:00', '12:00']);
    assert.equal(r.kod, 400);
    assert.match(r.fel, /arbetstid/);
  });

  it('standardarbetstiden är 09–18', async () => {
    const d = dag(3);
    tiderIDatabasen(s, nils.id, d, ['08:30', '09:00', '18:00', '18:30']);
    assert.deepEqual(await bokbara(nils, d), ['09:00', '18:00']);
  });

  it('minst tre timmar mellan två möten, åt båda hållen', async () => {
    const d = dag(4);
    const alla = ['09:00', '09:30', '10:00', '11:00', '12:00', '13:00', '14:00', '14:30', '15:00'];
    await tider(karl, d, alla);
    assert.equal((await boka(bokare, { datum: d, tid: '12:00', saljare_id: karl.id })).kod, 200);
    assert.deepEqual(await bokbara(karl, d), ['09:00', '15:00']);

    const nara = await boka(bokare, { datum: d, tid: '10:00', saljare_id: karl.id });
    assert.equal(nara.kod, 409);
    assert.match(nara.fel, /3 timmar/);
  });

  it('en blockerad tid erbjuds inte, går inte att boka och överlever att dagen sparas om', async () => {
    const d = dag(5);
    await tider(karl, d, ['09:00', '12:00', '15:00']);
    const block = await anrop(s.url, 'saljartid-andra',
      { saljare_id: karl.id, datum: d, tider: ['12:00'], lage: 'blockera', orsak: 'Tandläkare' }, alma.token);
    assert.equal(block.kod, 200, block.fel);
    assert.deepEqual(await bokbara(karl, d), ['09:00', '15:00']);

    const r = await boka(bokare, { datum: d, tid: '12:00', saljare_id: karl.id });
    assert.equal(r.kod, 409);
    assert.match(r.fel, /blockerad/);

    await tider(karl, d, ['09:00', '12:00', '15:00']);
    assert.deepEqual(await bokbara(karl, d), ['09:00', '15:00'], 'blockeringen försvann när dagen sparades om');

    const upp = await anrop(s.url, 'saljartid-andra',
      { saljare_id: karl.id, datum: d, tider: ['12:00'], lage: 'avblockera' }, alma.token);
    assert.equal(upp.kod, 200, upp.fel);
    assert.ok(!(await bokbara(karl, d)).includes('12:00'), 'en avblockerad tid ska vara borttagen, inte ledig');
  });

  it('blockering för alla besiktare på en gång', async () => {
    const d = dag(6);
    await tider(karl, d, ['10:00']);
    await tider(nils, d, ['10:00']);
    const r = await anrop(s.url, 'saljartid-andra',
      { saljare_id: 'alla', datum: d, tider: ['10:00'], lage: 'blockera', orsak: 'Personalmöte' }, plusBokare.token);
    assert.equal(r.kod, 200, r.fel);
    assert.deepEqual(await erbjudnaDagar(d, d), []);
  });

  it('lägg till och ta bort enskilda tider utan att röra resten av dagen', async () => {
    const d = dag(7);
    await tider(nils, d, ['09:00']);
    const till = await anrop(s.url, 'saljartid-andra',
      { saljare_id: nils.id, datum: d, tider: ['12:00', '15:00'], lage: 'lagg_till' }, nils.token);
    assert.equal(till.kod, 200, till.fel);
    assert.deepEqual(await bokbara(nils, d), ['09:00', '12:00', '15:00']);
    await anrop(s.url, 'saljartid-andra', { saljare_id: nils.id, datum: d, tider: ['12:00'], lage: 'ta_bort' }, nils.token);
    assert.deepEqual(await bokbara(nils, d), ['09:00', '15:00']);
  });

  it('en tid som redan varit erbjuds inte', async () => {
    const igar = plus(new Date().toISOString().slice(0, 10), -1);
    tiderIDatabasen(s, nils.id, igar, ['12:00']);
    assert.deepEqual(await bokbara(nils, igar), []);
    const r = await boka(bokare, { datum: igar, tid: '12:00', saljare_id: nils.id });
    assert.equal(r.kod, 409);
  });

  it('två samtidiga bokningar 09 och 10 hos samma besiktare: bara en går igenom', async () => {
    const d = dag(8);
    await tider(nils, d, ['09:00', '10:00']);
    const svar = await Promise.all([
      boka(bokare, { datum: d, tid: '09:00', saljare_id: nils.id }),
      boka(plusBokare, { datum: d, tid: '10:00', saljare_id: nils.id }),
    ]);
    assert.deepEqual(svar.map((r) => r.kod).sort(), [200, 409]);
    assert.equal(s.sql(`SELECT COUNT(*) AS n FROM bokningar WHERE saljare_id = ? AND datum = ?`, nils.id, d)[0].n, 1);
  });

  it('tre samtidiga bokningar hos en besiktare med max 2: exakt två går igenom', async () => {
    const d = dag(9);
    await tider(max, d, ['09:00', '12:00', '15:00']);
    const svar = await Promise.all(['09:00', '12:00', '15:00'].map((tid, i) =>
      boka([bokare, plusBokare, admin][i], { datum: d, tid, saljare_id: max.id })));
    assert.equal(svar.filter((r) => r.kod === 200).length, 2, JSON.stringify(svar.map((r) => r.fel)));
    assert.equal(s.sql(`SELECT COUNT(*) AS n FROM bokningar WHERE saljare_id = ? AND datum = ? AND status <> 'avbokad'`,
      max.id, d)[0].n, 2);
  });

  it('en bokning som nekas lämnar inget besök och ingen grön dörr efter sig', async () => {
    const d = dag(0);
    const fore = s.sql('SELECT COUNT(*) AS n FROM handelser')[0].n;
    const r = await boka(bokare, { datum: d, tid: '18:00', saljare_id: max.id, adress: 'Spårlösa vägen 3, Sala' });
    assert.equal(r.kod, 409);
    assert.equal(s.sql('SELECT COUNT(*) AS n FROM handelser')[0].n, fore);
    const dorr = s.sql(`SELECT status FROM adresser WHERE gata = 'Spårlösa vägen'`);
    assert.ok(!dorr.length || dorr[0].status !== 'bokat');
  });

  it('tiden först: "17:00 passar" ger dagarna och besiktarna som har den', async () => {
    const d1 = dag(10), d2 = dag(11);
    await tider(karl, d1, ['17:00']);
    await tider(nils, d2, ['17:00']);
    await tider(nils, d1, ['09:00']);
    const r = await anrop(s.url, 'bokbara-tider', { tid: '17:00', fran: d1, till: d2 }, bokare.token);
    assert.equal(r.kod, 200, r.fel);
    assert.deepEqual(r.dagar.map((x) => [x.datum, x.besiktare.map((b) => b.namn)]),
      [[d1, ['Karl Besiktare']], [d2, ['Nils Besiktare']]]);
  });

  it('servern väljer själv när bara en besiktare kan ta tiden', async () => {
    const d = dag(12);
    await tider(karl, d, ['12:00']);
    await tider(nils, d, ['10:00', '12:00']);
    assert.equal((await boka(bokare, { datum: d, tid: '10:00', saljare_id: nils.id })).kod, 200);
    // Nils har ett möte 10 och kan inte ta 12 — då blir det Karl.
    const r = await boka(bokare, { datum: d, tid: '12:00' });
    assert.equal(r.kod, 200, r.fel);
    assert.equal(r.bokning.saljare_id, karl.id);
  });
});
