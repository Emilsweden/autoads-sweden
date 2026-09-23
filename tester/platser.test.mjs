/**
 * Var besiktarna jobbar, och vilka adresser som är vilka.
 *
 *   G  en besiktare i Sala syns för en adress i Sala, men inte för en i
 *      Stockholm — och servern vägrar boka honom där
 *   en besiktare utan orter kan bokas överallt
 *   12, 12A och 12b är tre olika hus; "12 a" är samma hus som 12A
 *   samma gata i två städer är två adresser
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta } from './hjalp.mjs';

const DAG = nasta(4);

describe('orter och adresser', () => {
  let s, admin, alma, bokare, max, alexander, sven, utanOrt, platser;
  const plats = (namn) => platser.find((p) => p.namn === namn).id;
  const bokbaraNamn = async (extra) => {
    const r = await anrop(s.url, 'bokbara-tider', { datum: DAG, ...extra }, bokare.token);
    assert.equal(r.kod, 200, r.fel);
    return [...new Set(r.tider.flatMap((t) => t.besiktare.map((b) => b.namn)))].sort();
  };

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    alma = await sys.konto('Alma Admin', 'saljadmin');
    bokare = await sys.konto('Bea Bokare', 'saljare');
    platser = (await anrop(s.url, 'platser', {}, alma.token)).platser;
    max = await sys.konto('Max Besiktare', 'besiktare', { platser: [plats('Sala'), plats('Västerås')] });
    alexander = await sys.konto('Alexander Besiktare', 'besiktare', { platser: [plats('Sala')] });
    sven = await sys.konto('Sven Besiktare', 'besiktare', { platser: [plats('Stockholm')] });
    utanOrt = await sys.konto('Ulla Besiktare', 'besiktare');
    for (const b of [max, alexander, sven, utanOrt]) {
      await anrop(s.url, 'saljartider-spara', { saljare_id: b.id, datum: DAG, tider: ['10:00', '14:00'] }, admin.token);
    }
    await anrop(s.url, 'omrade-spara', { namn: 'Sala', ort: 'Sala' }, admin.token);
  });
  after(() => s.stang());

  it('orterna finns från början: Sala, Västerås, Köping, Örebro, Stockholm', () => {
    assert.deepEqual(platser.map((p) => p.namn).sort(),
      ['Köping', 'Sala', 'Stockholm', 'Västerås', 'Örebro']);
  });

  it('G: en adress i Sala visar besiktarna i Sala — och den utan orter', async () => {
    assert.deepEqual(await bokbaraNamn({ postort: 'Sala' }),
      ['Alexander Besiktare', 'Max Besiktare', 'Ulla Besiktare']);
    assert.deepEqual(await bokbaraNamn({ postort: 'Stockholm' }), ['Sven Besiktare', 'Ulla Besiktare']);
    // Utan adress visas alla.
    assert.equal((await bokbaraNamn({})).length, 4);
  });

  it('G: orten hittas från läget när adressen saknar ort', async () => {
    // Mitt i Sala, utan postort.
    assert.deepEqual(await bokbaraNamn({ lat: 59.92, lon: 16.60 }),
      ['Alexander Besiktare', 'Max Besiktare', 'Ulla Besiktare']);
  });

  it('G: lediga dagar och kalendern följer adressens ort', async () => {
    const dagar = await anrop(s.url, 'lediga-dagar', { fran: DAG, till: DAG, postort: 'Stockholm' }, bokare.token);
    assert.deepEqual(dagar.dagar[0].besiktare, ['Sven Besiktare', 'Ulla Besiktare']);
  });

  it('G: servern bokar inte en Stockholmsbesiktare på en adress i Sala', async () => {
    const r = await anrop(s.url, 'kalender-boka', {
      datum: DAG, tid: '10:00', saljare_id: sven.id, fornamn: 'K', telefon: '070', adress: 'Kyrkogatan 3, Sala',
    }, bokare.token);
    assert.equal(r.kod, 409);
    assert.match(r.fel, /Sala/);
    const ok = await anrop(s.url, 'kalender-boka', {
      datum: DAG, tid: '10:00', saljare_id: alexander.id, fornamn: 'K', telefon: '070', adress: 'Kyrkogatan 3, Sala',
    }, bokare.token);
    assert.equal(ok.kod, 200, ok.fel);
  });

  it('dörrens adress avgör vilka besiktare som erbjuds', async () => {
    const [dorr] = s.sql(`SELECT id FROM adresser WHERE gata = 'Kyrkogatan'`);
    assert.deepEqual(await bokbaraNamn({ adress_id: dorr.id }),
      ['Alexander Besiktare', 'Max Besiktare', 'Ulla Besiktare']);
  });

  it('Admin Besiktare sätter en besiktares orter', async () => {
    const r = await anrop(s.url, 'anvandare-spara', {
      id: sven.id, namn: 'Sven Besiktare', epost: sven.epost, roll: 'besiktare', platser: [plats('Stockholm'), plats('Sala')],
    }, alma.token);
    assert.equal(r.kod, 200, r.fel);
    assert.ok((await bokbaraNamn({ postort: 'Sala' })).includes('Sven Besiktare'));
  });

  it('en ny ort kan läggas till och används direkt', async () => {
    const r = await anrop(s.url, 'plats-spara', { namn: 'Enköping', lat: 59.6356, lon: 17.0776 }, alma.token);
    assert.equal(r.kod, 200, r.fel);
    assert.equal((await anrop(s.url, 'plats-spara', { namn: 'X' }, bokare.token)).kod, 403);
  });

  it('12, 12A och 12b är tre hus; "12 a" är samma hus som 12A', async () => {
    const ny = (nummer) => anrop(s.url, 'adress-ny', { gata: 'Björkvägen', nummer, postort: 'Sala' }, bokare.token);
    const tolv = await ny('12');
    const tolvA = await ny('12A');
    const tolvB = await ny('12b');
    assert.equal(new Set([tolv.adress.id, tolvA.adress.id, tolvB.adress.id]).size, 3);
    assert.equal(tolvB.adress.nummer, '12B');
    const igen = await ny('12 a');
    assert.equal(igen.adress.id, tolvA.adress.id);
    assert.equal(igen.fanns, true);
  });

  it('samma gata i två städer är två adresser, och kommunen sparas', async () => {
    const a = await anrop(s.url, 'adress-ny',
      { gata: 'Storgatan', nummer: '1', postort: 'Sala', kommun: 'Sala kommun' }, bokare.token);
    const b = await anrop(s.url, 'adress-ny',
      { gata: 'Storgatan', nummer: '1', postort: 'Västerås', kommun: 'Västerås kommun' }, bokare.token);
    assert.notEqual(a.adress.id, b.adress.id);
    assert.equal(s.sql('SELECT kommun FROM adresser WHERE id = ?', a.adress.id)[0].kommun, 'Sala');
  });
});
