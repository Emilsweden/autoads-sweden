/**
 * Vem som får göra vad. Gränsen ligger i servern — appen är bara en av
 * vägarna in till API:t, så varje regel här prövas mot API:t direkt.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, loggaIn, nasta, LOSENORD } from './hjalp.mjs';

describe('behörigheter', () => {
  let s, sys, admin, anna, bosse, plusBokare, karl, alma, omrA, omrB, bgatan;

  before(async () => {
    s = await starta();
    sys = await nyttSystem(s);
    admin = sys.admin;
    anna = await sys.konto('Anna Bokare', 'saljare');
    bosse = await sys.konto('Bosse Bokare', 'saljare');
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    alma = await sys.konto('Alma Admin', 'saljadmin');

    omrA = (await anrop(s.url, 'omrade-spara', { namn: 'Område A', ort: 'Örebro' }, admin.token)).id;
    omrB = (await anrop(s.url, 'omrade-spara', { namn: 'Område B', ort: 'Örebro' }, admin.token)).id;
    await anrop(s.url, 'omrade-tilldela', { omrade_id: omrA, saljare: [anna.id] }, admin.token);
    await anrop(s.url, 'omrade-tilldela', { omrade_id: omrB, saljare: [bosse.id] }, admin.token);
    await anrop(s.url, 'adresser-importera', { omrade_id: omrB,
      adresser: [{ gata: 'Bgatan', nummer: '2', postort: 'Örebro' }] }, admin.token);
    bgatan = s.sql(`SELECT id FROM adresser WHERE gata = 'Bgatan'`)[0].id;
  });
  after(() => s.stang());

  it('en mötesbokare läser och skriver inte på dörrar i någon annans område', async () => {
    const las = await anrop(s.url, 'adress', { id: bgatan }, anna.token);
    assert.equal(las.kod, 403);
    const skriv = await anrop(s.url, 'handelse', { adress_id: bgatan, resultat: 'nej', bekrafta: true }, anna.token);
    assert.equal(skriv.kod, 403);
    assert.equal(s.sql('SELECT status FROM adresser WHERE id = ?', bgatan)[0].status, 'ejbesokt');
  });

  it('besiktaren når inte adressregistret eller statistiken', async () => {
    assert.equal((await anrop(s.url, 'adresser', {}, karl.token)).kod, 403);
    assert.equal((await anrop(s.url, 'dashboard', { fran: '2000-01-01', till: '2100-01-01' }, karl.token)).kod, 403);
  });

  it('statistiken är för Mötesbokare+ och Admin Besiktare — inte för en vanlig mötesbokare', async () => {
    const period = { fran: '2000-01-01', till: '2100-01-01' };
    assert.equal((await anrop(s.url, 'dashboard', period, anna.token)).kod, 403);
    assert.equal((await anrop(s.url, 'dashboard', period, plusBokare.token)).kod, 200);
    assert.equal((await anrop(s.url, 'dashboard', period, alma.token)).kod, 200);
  });

  it('Mötesbokare+ skapar konton, men inga administratörer och rör inte administratörens konto', async () => {
    const vanlig = await anrop(s.url, 'anvandare-spara',
      { namn: 'Ny Bokare', epost: 'ny@vt.test', roll: 'saljare', losenord: LOSENORD }, plusBokare.token);
    assert.equal(vanlig.kod, 200, vanlig.fel);
    const nyAdmin = await anrop(s.url, 'anvandare-spara',
      { namn: 'Ny Admin', epost: 'nyadmin@vt.test', roll: 'admin', losenord: LOSENORD }, plusBokare.token);
    assert.equal(nyAdmin.kod, 403);
    const kapa = await anrop(s.url, 'anvandare-spara',
      { id: admin.id, namn: 'Kapad', epost: 'admin@vt.test', roll: 'saljare' }, plusBokare.token);
    assert.equal(kapa.kod, 403);
  });

  it('en mötesbokare skapar inga konton', async () => {
    const r = await anrop(s.url, 'anvandare-spara',
      { namn: 'X', epost: 'x@vt.test', roll: 'saljare', losenord: LOSENORD }, anna.token);
    assert.equal(r.kod, 403);
  });

  it('en trasig roll ger 403, inte ett serverfel', async () => {
    // "constructor" finns på Object.prototype. Slås rollen upp utan
    // hasOwnProperty hittas en funktion i stället för en lista och servern kraschar.
    await anrop(s.url, 'anvandare-spara',
      { namn: 'Bakdörr', epost: 'bak@vt.test', roll: 'constructor', losenord: LOSENORD }, admin.token);
    assert.equal(s.sql(`SELECT roll FROM anvandare WHERE epost = 'bak@vt.test'`)[0].roll, 'saljare');
    s.db.prepare(`UPDATE anvandare SET roll = 'constructor' WHERE epost = 'bak@vt.test'`).run();
    const bak = await loggaIn(s, 'bak@vt.test');
    const r = await anrop(s.url, 'anvandare-spara',
      { namn: 'Y', epost: 'y@vt.test', roll: 'admin', losenord: LOSENORD }, bak.token);
    assert.equal(r.kod, 403);
  });

  it('ett lösenordsbyte loggar ut alla andra telefoner', async () => {
    const annanTelefon = await loggaIn(s, bosse.epost);
    const byte = await anrop(s.url, 'byt-losenord', { gammalt: LOSENORD, nytt: 'nyttlosen123' }, bosse.token);
    assert.equal(byte.kod, 200, byte.fel);
    assert.equal((await anrop(s.url, 'jag', {}, annanTelefon.token)).kod, 401);
    assert.equal((await anrop(s.url, 'jag', {}, byte.token)).kod, 200);
  });

  it('en nyhet som tas bort försvinner bara för den som tog bort den', async () => {
    const dag = nasta(3);
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: dag, tider: ['10:00'] }, admin.token);
    const bok = await anrop(s.url, 'kalender-boka', {
      datum: dag, tid: '10:00', saljare_id: karl.id, fornamn: 'Nils', telefon: '070', adress: 'Nyhetsgatan 1, Örebro',
    }, plusBokare.token);
    assert.equal(bok.kod, 200, bok.fel);

    const karlsFore = (await anrop(s.url, 'nyheter', {}, karl.token)).nyheter;
    const nyhet = karlsFore.find((n) => /Nils/.test(n.text));
    assert.ok(nyhet, 'besiktaren fick ingen nyhet om bokningen');
    const plusFore = (await anrop(s.url, 'nyheter', {}, plusBokare.token)).nyheter.length;

    assert.equal((await anrop(s.url, 'nyhet-dolj', { id: nyhet.id }, karl.token)).kod, 200);

    const karlsEfter = (await anrop(s.url, 'nyheter', {}, karl.token)).nyheter;
    assert.ok(!karlsEfter.some((n) => n.id === nyhet.id), 'nyheten finns kvar hos den som tog bort den');
    assert.equal((await anrop(s.url, 'nyheter', {}, plusBokare.token)).nyheter.length, plusFore,
      'nyheten försvann för någon annan också');
    assert.equal(s.sql('SELECT COUNT(*) AS n FROM nyheter WHERE id = ?', nyhet.id)[0].n, 1,
      'nyheten raderades ur databasen');
  });
});
