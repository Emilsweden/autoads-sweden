/**
 * De fyra rollerna i appen och vad var och en får göra. Allt prövas mot
 * API:t direkt — en dold knapp är ingen behörighet.
 *
 *   Mötesbokare    bokar, ser bara bokningsbara tider och sina egna bokningar
 *   Mötesbokare+   ser, ändrar och raderar allt; styr konton och scheman
 *   Besiktare      sitt eget schema och sina egna möten
 *   Admin Besiktare  styr besiktarna — men är inte själv bokningsbar, skapar
 *                  bara besiktare och kan aldrig höja någons roll
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta, plus, LOSENORD } from './hjalp.mjs';

const DAG = nasta(2);

describe('rollerna', () => {
  let s, sys, admin, plusBokare, bea, olle, karl, nils, alma;
  let beasBokning, ollesBokning;

  const boka = (vem, data) => anrop(s.url, 'kalender-boka', {
    fornamn: 'Kund', telefon: '070-000', adress: `Rollgatan ${Math.floor(Math.random() * 1e6)}, Sala`, ...data,
  }, vem.token);

  before(async () => {
    s = await starta();
    sys = await nyttSystem(s);
    admin = sys.admin;
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    bea = await sys.konto('Bea Bokare', 'saljare');
    olle = await sys.konto('Olle Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    nils = await sys.konto('Nils Besiktare', 'besiktare');
    alma = await sys.konto('Alma Admin', 'saljadmin');

    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: DAG, tider: ['09:00', '12:00', '15:00'] }, admin.token);
    await anrop(s.url, 'saljartider-spara', { saljare_id: nils.id, datum: DAG, tider: ['09:00', '12:00'] }, admin.token);
    beasBokning = (await boka(bea, { datum: DAG, tid: '09:00', saljare_id: karl.id, fornamn: 'Beas kund' })).bokning.id;
    ollesBokning = (await boka(olle, { datum: DAG, tid: '09:00', saljare_id: nils.id, fornamn: 'Olles kund' })).bokning.id;
  });
  after(() => s.stang());

  describe('Admin Besiktare', () => {
    it('är inte bokningsbar och har inget eget schema', async () => {
      const lista = await anrop(s.url, 'lediga-besiktare', { datum: DAG, tid: '12:00' }, bea.token);
      assert.ok(!lista.besiktare.some((b) => b.id === alma.id));
      const tider = await anrop(s.url, 'saljartider', { fran: DAG, till: DAG }, alma.token);
      assert.ok(!tider.saljare.some((b) => b.id === alma.id), 'Admin Besiktare står med bland besiktarna');
      const egen = await anrop(s.url, 'saljartider-spara', { saljare_id: alma.id, datum: DAG, tider: ['12:00'] }, alma.token);
      assert.notEqual(egen.kod, 200);
      const r = await boka(bea, { datum: DAG, tid: '12:00', saljare_id: alma.id });
      assert.notEqual(r.kod, 200);
    });

    it('skapar besiktare, men inga andra roller', async () => {
      const ny = await anrop(s.url, 'anvandare-spara',
        { namn: 'Ny Besiktare', epost: 'nybes@vt.test', roll: 'besiktare', losenord: LOSENORD }, alma.token);
      assert.equal(ny.kod, 200, ny.fel);
      for (const roll of ['saljare', 'bokare_plus', 'saljadmin', 'teamleader', 'admin']) {
        const r = await anrop(s.url, 'anvandare-spara',
          { namn: 'X', epost: `x-${roll}@vt.test`, roll, losenord: LOSENORD }, alma.token);
        assert.equal(r.kod, 403, `Admin Besiktare kunde skapa ${roll}`);
      }
    });

    it('kan inte höja sin egen roll eller göra en besiktare till något annat', async () => {
      const sig = await anrop(s.url, 'anvandare-spara',
        { id: alma.id, namn: 'Alma Admin', epost: alma.epost, roll: 'bokare_plus' }, alma.token);
      assert.equal(sig.kod, 403);
      const hoj = await anrop(s.url, 'anvandare-spara',
        { id: nils.id, namn: 'Nils Besiktare', epost: nils.epost, roll: 'saljadmin' }, alma.token);
      assert.equal(hoj.kod, 403);
      const bokarkonto = await anrop(s.url, 'anvandare-spara',
        { id: bea.id, namn: 'Bea Bokare', epost: bea.epost, roll: 'saljare', max_per_dag: 5 }, alma.token);
      assert.equal(bokarkonto.kod, 403);
      assert.equal(s.sql('SELECT roll FROM anvandare WHERE id = ?', alma.id)[0].roll, 'saljadmin');
    });

    it('ändrar en besiktares max per dag och arbetstid', async () => {
      const r = await anrop(s.url, 'anvandare-spara', {
        id: nils.id, namn: 'Nils Besiktare', epost: nils.epost, roll: 'besiktare',
        max_per_dag: 2, arbetstid_fran: '10:00', arbetstid_till: '19:00',
      }, alma.token);
      assert.equal(r.kod, 200, r.fel);
      const [rad] = s.sql('SELECT max_per_dag, arbetstid_fran, arbetstid_till FROM anvandare WHERE id = ?', nils.id);
      assert.deepEqual({ ...rad }, { max_per_dag: 2, arbetstid_fran: '10:00', arbetstid_till: '19:00' });
    });

    it('styr alla besiktares tider — också en besiktare som läggs upp senare', async () => {
      const ny = await sys.konto('Senare Besiktare', 'besiktare');
      const r = await anrop(s.url, 'saljartider-spara', { saljare_id: ny.id, datum: DAG, tider: ['12:00'] }, alma.token);
      assert.equal(r.kod, 200, r.fel);
    });

    it('ser och ändrar alla besiktares bokningar, men raderar dem inte', async () => {
      const lista = await anrop(s.url, 'bokningar', { fran: DAG, till: DAG }, alma.token);
      assert.ok(lista.bokningar.some((b) => b.id === beasBokning));
      assert.ok(lista.bokningar.some((b) => b.id === ollesBokning));
      const andra = await anrop(s.url, 'bokning-andra', { id: beasBokning, telefon: '070-111' }, alma.token);
      assert.equal(andra.kod, 200, andra.fel);
      const radera = await anrop(s.url, 'bokning-ta-bort', { id: beasBokning }, alma.token);
      assert.equal(radera.kod, 403);
    });
  });

  describe('Besiktare', () => {
    it('ser bara sitt eget schema och ändrar bara det', async () => {
      const tider = await anrop(s.url, 'saljartider', { fran: DAG, till: DAG }, karl.token);
      assert.equal(tider.kod, 200, tider.fel);
      assert.deepEqual(tider.saljare.map((b) => b.id), [karl.id]);
      const egen = await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: plus(DAG, 1), tider: ['12:00'] }, karl.token);
      assert.equal(egen.kod, 200, egen.fel);
      const annans = await anrop(s.url, 'saljartider-spara', { saljare_id: nils.id, datum: plus(DAG, 1), tider: ['12:00'] }, karl.token);
      assert.equal(annans.kod, 403);
      const block = await anrop(s.url, 'saljartid-andra',
        { saljare_id: nils.id, datum: DAG, tider: ['12:00'], lage: 'blockera' }, karl.token);
      assert.equal(block.kod, 403);
    });

    it('ser och ändrar bara sina egna möten, och bokar inga', async () => {
      const lista = await anrop(s.url, 'bokningar', { fran: DAG, till: DAG }, karl.token);
      assert.deepEqual(lista.bokningar.map((b) => b.id), [beasBokning]);
      assert.equal((await anrop(s.url, 'bokning-andra', { id: beasBokning, kommentar: 'Stege behövs' }, karl.token)).kod, 200);
      assert.equal((await anrop(s.url, 'bokning-andra', { id: ollesBokning, kommentar: 'Kapat' }, karl.token)).kod, 403);
      assert.equal((await boka(karl, { datum: DAG, tid: '15:00', saljare_id: karl.id })).kod, 403);
      assert.equal((await anrop(s.url, 'bokning-ta-bort', { id: beasBokning }, karl.token)).kod, 403);
    });

    it('kan inte flytta sitt möte till en annan besiktare', async () => {
      const r = await anrop(s.url, 'bokning-andra', { id: beasBokning, saljare_id: nils.id }, karl.token);
      assert.equal(r.kod, 403);
    });
  });

  describe('Mötesbokare', () => {
    it('ser bara bokningsbara tider och sina egna bokningar', async () => {
      assert.equal((await anrop(s.url, 'saljartider', { fran: DAG, till: DAG }, bea.token)).kod, 403);
      const kal = await anrop(s.url, 'kalender', { fran: DAG, till: DAG }, bea.token);
      assert.deepEqual(kal.bokningar.map((b) => b.id), [beasBokning]);
      const lista = await anrop(s.url, 'bokningar', { fran: DAG, till: DAG }, bea.token);
      assert.deepEqual(lista.bokningar.map((b) => b.id), [beasBokning]);
    });

    it('ändrar sin egen bokning men inte någon annans', async () => {
      assert.equal((await anrop(s.url, 'bokning-andra', { id: beasBokning, fornamn: 'Bea ändrade' }, bea.token)).kod, 200);
      assert.equal((await anrop(s.url, 'bokning-andra', { id: ollesBokning, fornamn: 'Kapad' }, bea.token)).kod, 403);
    });

    it('raderar sin egen bokning men inte någon annans', async () => {
      const egen = (await boka(bea, { datum: DAG, tid: '15:00', saljare_id: karl.id, fornamn: 'Raderas' })).bokning.id;
      assert.equal((await anrop(s.url, 'bokning-ta-bort', { id: ollesBokning }, bea.token)).kod, 403);
      const r = await anrop(s.url, 'bokning-ta-bort', { id: egen }, bea.token);
      assert.equal(r.kod, 200, r.fel);
      assert.equal(s.sql('SELECT COUNT(*) AS n FROM bokningar WHERE id = ?', egen)[0].n, 0);
    });

    it('styr inga scheman och skapar inga konton', async () => {
      assert.equal((await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: DAG, tider: ['09:00'] }, bea.token)).kod, 403);
      assert.equal((await anrop(s.url, 'saljartid-andra',
        { saljare_id: karl.id, datum: DAG, tider: ['18:00'], lage: 'lagg_till' }, bea.token)).kod, 403);
      assert.equal((await anrop(s.url, 'anvandare-spara',
        { namn: 'Y', epost: 'y@vt.test', roll: 'besiktare', losenord: LOSENORD }, bea.token)).kod, 403);
    });
  });

  describe('Mötesbokare+', () => {
    it('ser, ändrar och raderar alla bokningar', async () => {
      const lista = await anrop(s.url, 'bokningar', { fran: DAG, till: DAG }, plusBokare.token);
      assert.ok(lista.bokningar.some((b) => b.id === ollesBokning));
      assert.equal((await anrop(s.url, 'bokning-andra', { id: ollesBokning, telefon: '070-222' }, plusBokare.token)).kod, 200);
      const tmp = (await boka(olle, { datum: DAG, tid: '12:00', saljare_id: nils.id, fornamn: 'Tillfällig' })).bokning.id;
      assert.equal((await anrop(s.url, 'bokning-ta-bort', { id: tmp }, plusBokare.token)).kod, 200);
    });

    it('byter besiktare på en bokning', async () => {
      const r = await anrop(s.url, 'bokning-andra', { id: beasBokning, saljare_id: nils.id, tid: '12:00' }, plusBokare.token);
      assert.equal(r.kod, 200, r.fel);
      assert.equal(s.sql('SELECT saljare_id FROM bokningar WHERE id = ?', beasBokning)[0].saljare_id, nils.id);
    });

    it('lägger upp alla lagets roller och styr alla scheman', async () => {
      for (const roll of ['saljare', 'bokare_plus', 'besiktare', 'saljadmin']) {
        const r = await anrop(s.url, 'anvandare-spara',
          { namn: 'Z', epost: `z-${roll}@vt.test`, roll, losenord: LOSENORD }, plusBokare.token);
        assert.equal(r.kod, 200, `${roll}: ${r.fel}`);
      }
      const r = await anrop(s.url, 'saljartid-andra',
        { saljare_id: karl.id, datum: plus(DAG, 3), tider: ['10:00'], lage: 'lagg_till' }, plusBokare.token);
      assert.equal(r.kod, 200, r.fel);
    });
  });
});
