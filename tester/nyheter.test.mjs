/**
 * Nyheterna och vyn över skapade bokningar.
 *
 *   Nya / Sedda     det man inte sett än står för sig
 *   Rensa allt      tömmer flödet för den som rensar — inte för någon annan
 *   Ingen spam      fyra tider inlagda i rad är en nyhet, inte fyra
 *   Skapade         bokningarna i den ordning de gjordes, inte mötesdatum
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta, plus } from './hjalp.mjs';

const DAG = nasta(2);
const vanta = (ms) => new Promise((r) => setTimeout(r, ms));

describe('nyheter och skapade bokningar', () => {
  let s, admin, plusBokare, bea, olle, karl;
  const boka = (vem, namn, datum, tid, extra = {}) => anrop(s.url, 'kalender-boka', {
    datum, tid, saljare_id: karl.id, fornamn: namn, telefon: '070', adress: namn + 'vägen 1, Sala', ...extra,
  }, vem.token);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    bea = await sys.konto('Bea Bokare', 'saljare');
    olle = await sys.konto('Olle Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare', { max_per_dag: 5 });
  });
  after(() => s.stang());

  it('fyra tider inlagda i rad blir en nyhet med alla fyra', async () => {
    for (const tid of ['09:00', '12:00', '15:00', '18:00']) {
      const r = await anrop(s.url, 'saljartid-andra',
        { saljare_id: karl.id, datum: DAG, tider: [tid], lage: 'lagg_till' }, admin.token);
      assert.equal(r.kod, 200, r.fel);
    }
    const rader = s.sql(`SELECT text FROM nyheter WHERE typ = 'tid'`);
    assert.equal(rader.length, 1, JSON.stringify(rader));
    for (const tid of ['09:00', '12:00', '15:00', '18:00']) assert.match(rader[0].text, new RegExp(tid));
  });

  it('det man inte sett än är nytt; efter att man sett det är det sett', async () => {
    await boka(bea, 'Först', DAG, '09:00');
    const fore = await anrop(s.url, 'nyheter', {}, plusBokare.token);
    assert.equal(fore.sedda_till, 0);
    const nyast = Math.max(...fore.nyheter.map((n) => n.skapad));
    assert.equal((await anrop(s.url, 'nyheter-sedda', { till: nyast }, plusBokare.token)).kod, 200);
    await vanta(5);
    await boka(bea, 'Sedan', DAG, '12:00');
    const efter = await anrop(s.url, 'nyheter', {}, plusBokare.token);
    assert.equal(efter.sedda_till, nyast);
    const nya = efter.nyheter.filter((n) => n.skapad > efter.sedda_till);
    assert.equal(nya.length, 1);
    assert.match(nya[0].text, /Sedan/);
  });

  it('seddamarkeringen går aldrig bakåt eller in i framtiden', async () => {
    const nu = (await anrop(s.url, 'nyheter', {}, plusBokare.token)).sedda_till;
    await anrop(s.url, 'nyheter-sedda', { till: 1 }, plusBokare.token);
    assert.equal((await anrop(s.url, 'nyheter', {}, plusBokare.token)).sedda_till, nu);
    await anrop(s.url, 'nyheter-sedda', { till: Date.now() + 86400e3 }, plusBokare.token);
    assert.ok((await anrop(s.url, 'nyheter', {}, plusBokare.token)).sedda_till <= Date.now());
  });

  it('Rensa allt tömmer flödet för den som rensar, inte för någon annan', async () => {
    const beasFore = (await anrop(s.url, 'nyheter', {}, bea.token)).nyheter.length;
    assert.ok(beasFore > 0);
    assert.equal((await anrop(s.url, 'nyheter-rensa', {}, plusBokare.token)).kod, 200);
    assert.equal((await anrop(s.url, 'nyheter', {}, plusBokare.token)).nyheter.length, 0);
    assert.equal((await anrop(s.url, 'nyheter', {}, bea.token)).nyheter.length, beasFore);
    // Det som händer efteråt syns igen.
    await vanta(5);
    await boka(olle, 'Efter', DAG, '15:00');
    assert.equal((await anrop(s.url, 'nyheter', {}, plusBokare.token)).nyheter.length, 1);
  });

  it('Skapade: bokningarna i den ordning de gjordes, med tiden de gjordes', async () => {
    const tidigt = plus(DAG, 7);
    await anrop(s.url, 'saljartid-andra', { saljare_id: karl.id, datum: tidigt, tider: ['10:00'], lage: 'lagg_till' }, admin.token);
    await vanta(5);
    // Ett möte långt fram, bokat sist: först i listan ändå.
    await boka(bea, 'Senast', tidigt, '10:00');
    const r = await anrop(s.url, 'bokningar', { sortera: 'skapad', skapad_efter: Date.now() - 3600e3 }, bea.token);
    assert.equal(r.kod, 200, r.fel);
    assert.deepEqual(r.bokningar.map((b) => b.fornamn), ['Senast', 'Sedan', 'Först']);
    assert.ok(r.bokningar.every((b) => typeof b.skapad === 'number'));
    // Mötesbokaren ser bara sina egna — Olles "Efter" är inte med.
    const plusLista = await anrop(s.url, 'bokningar', { sortera: 'skapad', skapad_efter: Date.now() - 3600e3 }, plusBokare.token);
    assert.equal(plusLista.bokningar[0].fornamn, 'Senast');
    assert.ok(plusLista.bokningar.some((b) => b.fornamn === 'Efter'));
  });
});
