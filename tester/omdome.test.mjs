/**
 * Omdöme efter mötet. När mötets starttid har passerat ska besiktaren
 * lämna omdöme — utan att någon först behöver markera det genomfört:
 *
 *   Genomfördes bokningen?
 *     JA   vad hände, anteckningar, intresse, blev det jobb
 *     NEJ  ingen hemma / kunden avbokade / kunden ringde och bokade om / annat
 *
 * Omdömet går alltid att ändra, och det gamla står kvar i historiken.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta, plus } from './hjalp.mjs';

describe('omdöme efter mötet', () => {
  let s, admin, bokare, karl, nils, alma, plusBokare, igar, imorgon;
  let flyttade = 0;

  /** Bokar i morgon och flyttar sedan mötet till i går direkt i databasen. */
  async function motetIgar(namn) {
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: imorgon, tider: ['10:00'] }, admin.token);
    const r = await anrop(s.url, 'kalender-boka', {
      datum: imorgon, tid: '10:00', saljare_id: karl.id, fornamn: namn, telefon: '070', adress: namn + 'gatan 1, Sala',
    }, bokare.token);
    assert.equal(r.kod, 200, r.fel);
    // En egen tid per möte — två möten hos samma besiktare samma tid stoppas av databasen.
    s.db.prepare('UPDATE bokningar SET datum = ?, tid = ? WHERE id = ?')
      .run(igar, String(6 + ++flyttade).padStart(2, '0') + ':00', r.bokning.id);
    return r.bokning.id;
  }
  const rad = async (vem, id) =>
    (await anrop(s.url, 'bokade-adresser', {}, vem.token)).bokningar.find((b) => b.id === id);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    bokare = await sys.konto('Bea Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    nils = await sys.konto('Nils Besiktare', 'besiktare');
    alma = await sys.konto('Alma Admin', 'saljadmin');
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    const idag = new Date().toISOString().slice(0, 10);
    // Två dagar åt var håll, så att tidszonen inte spelar någon roll.
    igar = plus(idag, -2);
    imorgon = plus(idag, 2);
  });
  after(() => s.stang());

  it('när starttiden passerat ska besiktaren lämna omdöme — utan att någon markerat något', async () => {
    const id = await motetIgar('Passerad');
    const b = await rad(karl, id);
    assert.equal(b.status, 'bokad');
    assert.equal(b.lamna_omdome, true);
    // Ett möte som inte varit än ska inte ha någon sådan uppmaning.
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: nasta(3), tider: ['12:00'] }, admin.token);
    const framtid = (await anrop(s.url, 'kalender-boka', {
      datum: nasta(3), tid: '12:00', saljare_id: karl.id, fornamn: 'Framtid', telefon: '070', adress: 'Framgatan 1, Sala',
    }, bokare.token)).bokning.id;
    assert.equal((await rad(karl, framtid)).lamna_omdome, false);
  });

  it('JA: vad hände, intresse och jobb sparas, och mötet blir genomfört', async () => {
    const id = await motetIgar('Jobbet');
    const r = await anrop(s.url, 'aterkoppling-spara', {
      bokning_id: id, genomford: true, vad_hande: 'Gick upp på taket', text: 'Mossa norrsidan',
      intresserad: true, blev_jobb: true, belopp: 185000,
    }, karl.token);
    assert.equal(r.kod, 200, r.fel);
    const b = await rad(karl, id);
    assert.equal(b.status, 'genomford');
    assert.equal(b.lamna_omdome, false);
    const senaste = b.aterkoppling.at(-1);
    assert.equal(senaste.utfall, 'salt');
    assert.equal(senaste.vad_hande, 'Gick upp på taket');
    assert.equal(senaste.blev_jobb, 1);
  });

  it('NEJ: orsaken sparas och mötet markeras som inte genomfört', async () => {
    const id = await motetIgar('Ingen');
    const r = await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: id, genomford: false, orsak: 'ingen_hemma' }, karl.token);
    assert.equal(r.kod, 200, r.fel);
    const b = await rad(karl, id);
    assert.equal(b.status, 'ej_genomford');
    assert.equal(b.aterkoppling.at(-1).orsak, 'ingen_hemma');
    assert.match(b.aterkoppling.at(-1).utfall_text, /Ingen hemma/);
    const fel = await anrop(s.url, 'aterkoppling-spara', { bokning_id: id, genomford: false, orsak: 'påhittad' }, karl.token);
    assert.equal(fel.kod, 400);
  });

  it('omdömet går att ändra, och det gamla står kvar i historiken', async () => {
    const id = await motetIgar('Andrat');
    await anrop(s.url, 'aterkoppling-spara', { bokning_id: id, genomford: false, orsak: 'avbokade' }, karl.token);
    await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: id, genomford: true, blev_jobb: false, intresserad: true }, karl.token);
    const b = await rad(karl, id);
    assert.equal(b.aterkoppling.length, 2);
    assert.equal(b.status, 'genomford');
    assert.equal(b.aterkoppling.at(-1).utfall, 'uppfoljning');
  });

  it('kunden bokade om: mötet flyttas med samma id och är bokat igen', async () => {
    const id = await motetIgar('Omboka');
    await anrop(s.url, 'aterkoppling-spara', { bokning_id: id, genomford: false, orsak: 'ombokad' }, karl.token);
    const ny = nasta(4);
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: ny, tider: ['13:00'] }, admin.token);
    const r = await anrop(s.url, 'bokning-andra', { id, datum: ny, tid: '13:00' }, karl.token);
    assert.equal(r.kod, 200, r.fel);
    assert.equal(s.sql('SELECT status FROM bokningar WHERE id = ?', id)[0].status, 'bokad');
  });

  it('en besiktare lämnar inte omdöme på någon annans möte; Admin Besiktare och Mötesbokare+ gör', async () => {
    const id = await motetIgar('Annans');
    assert.equal((await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: id, genomford: true, blev_jobb: false }, nils.token)).kod, 403);
    assert.equal((await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: id, genomford: true, blev_jobb: false }, alma.token)).kod, 200);
    assert.equal((await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: id, genomford: true, blev_jobb: true }, plusBokare.token)).kod, 200);
    assert.equal((await anrop(s.url, 'aterkoppling-spara',
      { bokning_id: id, genomford: true, blev_jobb: true }, bokare.token)).kod, 403);
  });

  it('kommentarer och bilder syns för Admin Besiktare och Mötesbokare+', async () => {
    const id = await motetIgar('Synlig');
    await anrop(s.url, 'bokning-kommentar', { bokning_id: id, text: 'Tegel, 30 år' }, karl.token);
    await anrop(s.url, 'bokning-bilaga',
      { bokning_id: id, data: 'data:image/jpeg;base64,AAAA', namn: 'tak.jpg' }, karl.token);
    for (const vem of [alma, plusBokare]) {
      const b = await rad(vem, id);
      assert.equal(b.kommentarer.length, 1);
      assert.equal(b.bilagor.length, 1);
    }
  });
});
