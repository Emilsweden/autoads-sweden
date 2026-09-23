/**
 * Bokningsreglerna. Det här är det som får kosta pengar om det går sönder:
 * två kunder på samma besiktare samma timme, en fjärde bokning på någon som
 * bara klarar två, eller en mötesbokare som ändrar någon annans kund.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { starta, EFTER_SCHEMAT } from './server.mjs';
import { anrop, nyttSystem, nasta, plus } from './hjalp.mjs';

const MANDAG = nasta(1);
const TISDAG = plus(MANDAG, 1);
const TAGEN = 'Tiden är redan bokad – välj en annan tid';

describe('bokningar', () => {
  let s, admin, plusBokare, bokare, annanBokare, karl, susanne, alma, omrade;
  const boka = (vem, data) => anrop(s.url, 'kalender-boka', {
    fornamn: 'Kund', telefon: '070-000', adress: 'Testgatan 1, Västerås', omrade_id: omrade, ...data,
  }, vem.token);
  const tider = (vem, datum, lista) =>
    anrop(s.url, 'saljartider-spara', { saljare_id: vem.id, datum, tider: lista }, admin.token);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    bokare = await sys.konto('Bea Bokare', 'saljare');
    annanBokare = await sys.konto('Olle Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    susanne = await sys.konto('Susanne Besiktare', 'besiktare', { max_per_dag: 2 });
    alma = await sys.konto('Alma Admin', 'saljadmin');
    omrade = (await anrop(s.url, 'omrade-spara', { namn: 'Västerås', ort: 'Västerås' }, admin.token)).id;
  });
  after(() => s.stang());

  it('en tid ingen besiktare lagt in går inte att boka', async () => {
    const r = await boka(bokare, { datum: MANDAG, tid: '09:00' });
    assert.equal(r.kod, 409);
    assert.match(r.fel, /lagt in den tiden/);
  });

  it('bara dagar med en ledig tid erbjuds', async () => {
    await tider(karl, MANDAG, ['09:00', '13:00']);
    const r = await anrop(s.url, 'lediga-dagar', { fran: MANDAG, till: plus(MANDAG, 6) }, bokare.token);
    assert.equal(r.kod, 200);
    assert.deepEqual(r.dagar.map((d) => d.datum), [MANDAG]);
  });

  it('två som bokar samma besiktare samma tid samtidigt: en lyckas, en får veta att tiden togs', async () => {
    const [a, b] = await Promise.all([
      boka(bokare, { datum: MANDAG, tid: '09:00', saljare_id: karl.id, fornamn: 'Anna' }),
      boka(annanBokare, { datum: MANDAG, tid: '09:00', saljare_id: karl.id, fornamn: 'Johan' }),
    ]);
    assert.deepEqual([a.kod, b.kod].sort(), [200, 409]);
    assert.equal([a, b].find((r) => r.kod === 409).fel, TAGEN);
    const rader = s.sql(`SELECT * FROM bokningar WHERE datum = ? AND tid = '09:00' AND status <> 'avbokad'`, MANDAG);
    assert.equal(rader.length, 1);
  });

  it('databasen vägrar dubbelbokningen även förbi servern', () => {
    const [b] = s.sql(`SELECT * FROM bokningar WHERE datum = ? AND tid = '09:00'`, MANDAG);
    assert.throws(() => s.db.prepare(
      `INSERT INTO bokningar (id, adress_id, anvandare_id, fornamn, telefon, datum, tid, saljare_id, status, skapad)
       VALUES ('dubblett', ?, ?, 'X', '070', ?, '09:00', ?, 'bokad', 0)`,
    ).run(b.adress_id, b.anvandare_id, MANDAG, karl.id), /UNIQUE/);
  });

  it('när flera besiktare är lediga gissar servern inte', async () => {
    await tider(susanne, MANDAG, ['13:00']);
    const r = await boka(bokare, { datum: MANDAG, tid: '13:00' });
    assert.equal(r.kod, 409);
    assert.match(r.fel, /Välj vilken besiktare/);
  });

  it('Susanne tar två möten om dagen, sedan är hon full', async () => {
    await tider(susanne, TISDAG, ['09:00', '12:00', '15:00', '18:00']);
    for (const tid of ['09:00', '12:00']) {
      assert.equal((await boka(bokare, { datum: TISDAG, tid, saljare_id: susanne.id })).kod, 200);
    }
    const tredje = await boka(bokare, { datum: TISDAG, tid: '15:00', saljare_id: susanne.id });
    assert.equal(tredje.kod, 409);
    assert.match(tredje.fel, /fullt/);
    // Och hon erbjuds inte längre den dagen.
    const lediga = await anrop(s.url, 'lediga-dagar', { fran: TISDAG, till: TISDAG }, bokare.token);
    assert.equal(lediga.dagar.length, 0);
  });

  it('övriga besiktare tar tre, inte fyra', async () => {
    await tider(karl, TISDAG, ['09:00', '12:00', '15:00', '18:00']);
    for (const tid of ['09:00', '12:00', '15:00']) {
      assert.equal((await boka(bokare, { datum: TISDAG, tid, saljare_id: karl.id })).kod, 200);
    }
    const fjarde = await boka(bokare, { datum: TISDAG, tid: '18:00', saljare_id: karl.id });
    assert.equal(fjarde.kod, 409);
    assert.match(fjarde.fel, /fullt/);
  });

  it('Admin Besiktare går inte att boka — han styr besiktarna men åker inte ut själv', async () => {
    const egna = await anrop(s.url, 'saljartider-spara', { saljare_id: alma.id, datum: MANDAG, tider: ['13:00'] }, alma.token);
    assert.notEqual(egna.kod, 200);
    const avPlus = await boka(plusBokare, { datum: MANDAG, tid: '13:00', saljare_id: alma.id });
    assert.notEqual(avPlus.kod, 200);
    assert.equal(s.sql('SELECT COUNT(*) AS n FROM bokningar WHERE saljare_id = ?', alma.id)[0].n, 0);
  });

  it('bokningen mejlas till besiktaren som fick den, och bara till honom', async () => {
    const fore = s.brevlada.length;
    await tider(karl, MANDAG, ['09:00', '13:00', '16:00']);
    const r = await boka(bokare, {
      datum: MANDAG, tid: '16:00', saljare_id: karl.id, fornamn: 'Eva', efternamn: 'Ek', adress: 'Mejlgatan 7, Västerås',
    });
    assert.equal(r.kod, 200, r.fel);
    const nya = s.brevlada.slice(fore);
    assert.equal(nya.length, 1);
    assert.deepEqual(nya[0].to, [karl.epost]);
    assert.match(nya[0].text, /Eva/);
    assert.match(nya[0].text, /16:00/);
    assert.match(nya[0].text, /Mejlgatan 7/);
  });

  it('mötesbokaren ändrar sin egen bokning men inte någon annans', async () => {
    const [egen] = s.sql(`SELECT id FROM bokningar WHERE anvandare_id = ? AND fornamn = 'Eva'`, bokare.id);
    const andra = await anrop(s.url, 'bokning-andra', { id: egen.id, fornamn: 'Eva Ändrad' }, bokare.token);
    assert.equal(andra.kod, 200, andra.fel);

    const nekad = await anrop(s.url, 'bokning-andra', { id: egen.id, fornamn: 'Kapad' }, annanBokare.token);
    assert.equal(nekad.kod, 403);
    assert.equal(s.sql('SELECT fornamn FROM bokningar WHERE id = ?', egen.id)[0].fornamn, 'Eva Ändrad');

    const avPlus = await anrop(s.url, 'bokning-andra', { id: egen.id, kommentar: 'Ringde' }, plusBokare.token);
    assert.equal(avPlus.kod, 200, avPlus.fel);
  });

  it('månadslistan bär besiktarens återkoppling', async () => {
    const [b] = s.sql(`SELECT id FROM bokningar WHERE fornamn = 'Eva Ändrad'`);
    const aterk = await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: b.id, utfall: 'salt', belopp: 210000, text: 'Nytt tak' }, karl.token);
    assert.equal(aterk.kod, 200, aterk.fel);

    const lista = await anrop(s.url, 'bokningar', { fran: MANDAG, till: MANDAG }, bokare.token);
    const rad = lista.bokningar.find((x) => x.id === b.id);
    assert.ok(rad, 'bokningen saknas i listan');
    assert.ok(rad.aterkoppling, 'återkopplingen saknas på bokningen');
    assert.match(JSON.stringify(rad.aterkoppling), /salt/);
  });
});

describe('uppsättningen och testservern', () => {
  it('lägger på samma skydd mot dubbelbokning', () => {
    const workflow = readFileSync(new URL('../.github/workflows/satt-upp-faltsystemet.yml', import.meta.url), 'utf8');
    const utanMellanrum = (t) => t.replace(/\s+/g, ' ').trim();
    const unikt = utanMellanrum(EFTER_SCHEMAT.find((x) => x.includes('idx_bok_saljarslot')));
    assert.ok(utanMellanrum(workflow).includes(unikt.replace(/;$/, '')),
      'Indexet i tester/server.mjs och i .github/workflows/satt-upp-faltsystemet.yml har glidit isär');
  });
});
