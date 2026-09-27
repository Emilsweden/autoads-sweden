/**
 * Bevakade konton: allt ett bevakat konto gör syns i administratörens
 * nyheter — och bara där.
 *
 *   Det som redan blir en nyhet (radera bokning, ändra tider …) blir inte två
 *   Det som annars är tyst (kommentar, ändrat telefonnummer, ett Nej vid
 *   dörren …) blir en egen rad, med vem, vad och var
 *   Bara administratören ser raderna och kan slå på eller av bevakningen
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta, LOSENORD } from './hjalp.mjs';

const DAG = nasta(2);

describe('bevakade konton', () => {
  let s, admin, klasPlus, klasBes, klasAdmin, petra, bea, karl, bokning;
  const adminsNyheter = async () => (await anrop(s.url, 'nyheter', { antal: 200 }, admin.token)).nyheter;
  const aktivitet = async () => (await adminsNyheter()).filter((n) => n.typ === 'aktivitet');
  const bevaka = (vem, pa = true) => anrop(s.url, 'anvandare-spara', {
    id: vem.id, namn: vem.namn, epost: vem.epost, roll: vem.roll, bevakad: pa,
  }, admin.token);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    admin = sys.admin;
    klasPlus = { ...(await sys.konto('Klas Plus', 'bokare_plus')), roll: 'bokare_plus' };
    klasBes = { ...(await sys.konto('Klas Besiktare', 'besiktare')), roll: 'besiktare' };
    klasAdmin = { ...(await sys.konto('Klas Adminbes', 'saljadmin')), roll: 'saljadmin' };
    petra = await sys.konto('Petra Plus', 'bokare_plus');
    bea = await sys.konto('Bea Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    await anrop(s.url, 'saljartider-spara', { saljare_id: klasBes.id, datum: DAG, tider: ['09:00', '12:00'] }, admin.token);
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: DAG, tider: ['09:00', '12:00'] }, admin.token);
    bokning = (await anrop(s.url, 'kalender-boka', {
      datum: DAG, tid: '09:00', saljare_id: klasBes.id, fornamn: 'Eva', efternamn: 'Ek', telefon: '070-111',
      adress: 'Bevakningsgatan 4, Sala',
    }, bea.token)).bokning;
    for (const k of [klasPlus, klasBes, klasAdmin]) {
      const r = await bevaka(k);
      assert.equal(r.kod, 200, r.fel);
    }
  });
  after(() => s.stang());

  it('bara administratören slår på bevakning — Mötesbokare+ kan inte, inte ens av sig själv', async () => {
    const r = await anrop(s.url, 'anvandare-spara', {
      id: klasPlus.id, namn: 'Klas Plus', epost: klasPlus.epost, roll: 'bokare_plus', bevakad: false,
    }, klasPlus.token);
    assert.equal(r.kod, 200, r.fel);  // kontot sparas, men bevakningen står kvar
    assert.equal(s.sql('SELECT bevakad FROM anvandare WHERE id = ?', klasPlus.id)[0].bevakad, 1);
    await anrop(s.url, 'anvandare-spara', {
      id: bea.id, namn: 'Bea Bokare', epost: bea.epost, roll: 'saljare', bevakad: true,
    }, petra.token);
    assert.equal(s.sql('SELECT bevakad FROM anvandare WHERE id = ?', bea.id)[0].bevakad, null);
  });

  it('den som inte är administratör ser inte vem som är bevakad', async () => {
    const lista = await anrop(s.url, 'anvandare-lista', {}, petra.token);
    assert.ok(lista.anvandare.every((a) => !('bevakad' in a)));
    const adminsLista = await anrop(s.url, 'anvandare-lista', {}, admin.token);
    assert.equal(adminsLista.anvandare.find((a) => a.id === klasPlus.id).bevakad, 1);
  });

  it('en ändring som annars är tyst — ett nytt telefonnummer — syns med vad som ändrades', async () => {
    const r = await anrop(s.url, 'bokning-andra', { id: bokning.id, telefon: '070-999' }, klasPlus.token);
    assert.equal(r.kod, 200, r.fel);
    const rad = (await aktivitet()).find((n) => /telefon/.test(n.text));
    assert.ok(rad, 'ingen nyhet om ändringen');
    assert.match(rad.text, /Klas Plus/);
    assert.match(rad.text, /Bevakningsgatan 4/);
    assert.match(rad.text, /070-111.*070-999/);
  });

  it('en kommentar från den bevakade besiktaren syns med texten', async () => {
    await anrop(s.url, 'bokning-kommentar', { bokning_id: bokning.id, text: 'Tegeltak, stege behövs' }, klasBes.token);
    const rad = (await aktivitet()).find((n) => /kommenterade/.test(n.text));
    assert.ok(rad);
    assert.match(rad.text, /Klas Besiktare/);
    assert.match(rad.text, /Tegeltak, stege behövs/);
  });

  it('det som redan blir en nyhet blir inte två: en raderad bokning är en rad', async () => {
    const tmp = (await anrop(s.url, 'kalender-boka', {
      datum: DAG, tid: '12:00', saljare_id: karl.id, fornamn: 'Tillfällig', telefon: '070', adress: 'Tillfälliga vägen 1, Sala',
    }, bea.token)).bokning;
    const r = await anrop(s.url, 'bokning-ta-bort', { id: tmp.id }, klasPlus.token);
    assert.equal(r.kod, 200, r.fel);
    const rader = (await adminsNyheter()).filter((n) => /Tillfälliga vägen 1/.test(n.text) && /Klas Plus/.test(n.text));
    assert.equal(rader.length, 1, JSON.stringify(rader.map((n) => n.text)));
  });

  it('flera tider i rad från Admin Besiktare blir en nyhet med alla tiderna', async () => {
    for (const tid of ['13:00', '15:00', '17:00']) {
      await anrop(s.url, 'saljartid-andra', { saljare_id: karl.id, datum: DAG, tider: [tid], lage: 'lagg_till' }, klasAdmin.token);
    }
    const rader = (await adminsNyheter()).filter((n) => /Klas Adminbes/.test(n.text) && /Karl/.test(n.text));
    assert.equal(rader.length, 1, JSON.stringify(rader.map((n) => n.text)));
    assert.match(rader[0].text, /13:00.*15:00.*17:00/);
  });

  it('ett nekat försök syns inte — bara det som faktiskt gjordes', async () => {
    const fore = (await aktivitet()).length;
    assert.equal((await anrop(s.url, 'bokning-ta-bort', { id: bokning.id }, klasBes.token)).kod, 403);
    assert.equal((await aktivitet()).length, fore);
  });

  it('att bara titta blir ingen nyhet', async () => {
    const fore = (await aktivitet()).length;
    await anrop(s.url, 'bokningar', { fran: DAG, till: DAG }, klasPlus.token);
    await anrop(s.url, 'kalender', { fran: DAG, till: DAG }, klasPlus.token);
    await anrop(s.url, 'nyheter', {}, klasPlus.token);
    assert.equal((await aktivitet()).length, fore);
  });

  it('bevakningsraderna syns bara för administratören — inte för Mötesbokare+ eller Klas själv', async () => {
    for (const vem of [petra, klasPlus, klasBes, klasAdmin]) {
      const n = (await anrop(s.url, 'nyheter', { antal: 200 }, vem.token)).nyheter;
      assert.ok(!n.some((x) => x.typ === 'aktivitet'), 'aktivitet syns för ' + vem.namn);
    }
  });

  it('ett konto som inte är bevakat ger inga sådana rader', async () => {
    const fore = (await aktivitet()).length;
    await anrop(s.url, 'bokning-kommentar', { bokning_id: bokning.id, text: 'Bea skriver' }, bea.token);
    assert.equal((await aktivitet()).length, fore);
  });

  it('registreringar vid dörren syns: Nej på en adress', async () => {
    const dorr = (await anrop(s.url, 'adress-ny', { gata: 'Dörrvägen', nummer: '7', postort: 'Sala' }, klasPlus.token)).adress;
    await anrop(s.url, 'handelse', { adress_id: dorr.id, resultat: 'nej' }, klasPlus.token);
    const rader = (await aktivitet()).filter((n) => /Dörrvägen 7/.test(n.text));
    assert.ok(rader.some((n) => /Nej/.test(n.text)), JSON.stringify(rader.map((n) => n.text)));
  });

  it('en kontoändring med för kort lösenord sparas inte alls — inget ändras utan att synas', async () => {
    const r = await anrop(s.url, 'anvandare-spara', {
      id: bea.id, namn: 'Bea Bokare', epost: 'kapad@vt.test', roll: 'saljare', aktiv: false, losenord: 'kort',
    }, klasPlus.token);
    assert.equal(r.kod, 400);
    const [rad] = s.sql('SELECT epost, aktiv FROM anvandare WHERE id = ?', bea.id);
    assert.equal(rad.epost, bea.epost);
    assert.equal(rad.aktiv, 1);
  });

  it('två saker samtidigt: den ena tystar inte den andra', async () => {
    const kom = (await anrop(s.url, 'bokning-kommentar', { bokning_id: bokning.id, text: 'Ska tas bort' }, klasPlus.token)).kommentar;
    await Promise.all([
      anrop(s.url, 'bokning-kommentar-ta-bort', { id: kom.id }, klasPlus.token),
      anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: DAG, tider: ['09:00', '12:00', '16:00'] }, klasPlus.token),
    ]);
    assert.ok((await aktivitet()).some((n) => /tog bort kommentaren "Ska tas bort"/.test(n.text)),
      'borttagningen syntes inte');
  });

  it('raden beskriver det som faktiskt ändrades, vad som än skickas med', async () => {
    const dorr = (await anrop(s.url, 'adress-ny', { gata: 'Broschyrvägen', nummer: '2', postort: 'Sala' }, klasPlus.token)).adress;
    await anrop(s.url, 'adress-broschyr', { id: dorr.id, bokning_id: bokning.id }, klasPlus.token);
    const rad = (await aktivitet()).find((n) => /broschyr/.test(n.text));
    assert.ok(rad);
    assert.match(rad.text, /Broschyrvägen 2/);
  });

  it('administratören slår av bevakningen, och då slutar raderna', async () => {
    assert.equal((await bevaka(klasBes, false)).kod, 200);
    const fore = (await aktivitet()).length;
    await anrop(s.url, 'bokning-kommentar', { bokning_id: bokning.id, text: 'Efter avstängning' }, klasBes.token);
    assert.equal((await aktivitet()).length, fore);
  });

  it('räknaren: nyheterna säger hur många som är nya för administratören', async () => {
    const r = await anrop(s.url, 'nyheter', { antal: 200 }, admin.token);
    const nya = r.nyheter.filter((n) => n.skapad > r.sedda_till).length;
    assert.ok(nya > 0);
    assert.equal(typeof r.sedda_till, 'number');
    assert.ok(LOSENORD);
  });
});
