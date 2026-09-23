/**
 * Appen i en riktig webbläsare: att bokningen går i rätt ordning — dag, tid,
 * besiktare, sist kunden — och hamnar hos rätt besiktare.
 *
 * Kräver Playwright med Chromium. Finns det inte hoppas testet över i stället
 * för att fallera, så att API-testerna går att köra var som helst.
 * Alla anrop utanför testservern stoppas: testet ska inte bero på
 * OpenStreetMap eller något annat på nätet.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, nasta, LOSENORD } from './hjalp.mjs';

async function hittaPlaywright() {
  for (const vag of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try { return await import(vag); } catch { /* prova nästa */ }
  }
  return null;
}

const pw = await hittaPlaywright();

describe('appen', { skip: !pw && 'Playwright saknas — installera med: npm i -g playwright && npx playwright install chromium' }, () => {
  let s, webblasare, bokare, karl, plusBokare, alma;
  const MANDAG = nasta(1);

  before(async () => {
    s = await starta();
    const sys = await nyttSystem(s);
    bokare = await sys.konto('Bea Bokare', 'saljare');
    karl = await sys.konto('Karl Besiktare', 'besiktare');
    plusBokare = await sys.konto('Petra Plus', 'bokare_plus');
    alma = await sys.konto('Alma Admin', 'saljadmin');
    await anrop(s.url, 'omrade-spara', { namn: 'Västerås', ort: 'Västerås' }, sys.admin.token);
    await anrop(s.url, 'saljartider-spara', { saljare_id: karl.id, datum: MANDAG, tider: ['10:00', '14:00'] }, sys.admin.token);
    webblasare = await pw.chromium.launch();
  });
  after(async () => {
    await webblasare?.close();
    await s.stang();
  });

  async function oppna(epost) {
    const ctx = await webblasare.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const sida = await ctx.newPage();
    const fel = [];
    sida.on('pageerror', (e) => fel.push(e.message));
    await sida.route('**/*', (r) => (r.request().url().startsWith(s.url) ? r.continue() : r.abort()));
    await sida.goto(s.url + '/');
    await sida.fill('#lEpost', epost);
    await sida.fill('#lLosen', LOSENORD);
    await sida.click('#lKnapp');
    await sida.waitForSelector('#app:not([hidden])', { timeout: 10000 });
    return { sida, fel };
  }

  it('mötesbokaren har karta, bokningar, kommande och nyheter — ingen statistik', async () => {
    const { sida, fel } = await oppna(bokare.epost);
    const meny = await sida.$$eval('#botten button', (n) => n.map((e) => e.dataset.vy));
    assert.deepEqual(meny, ['karta', 'bokningar', 'lista', 'nyheter']);
    assert.deepEqual(fel, []);
    await sida.context().close();
  });

  it('bokningen går dag → tid → besiktare → kund, och hamnar hos besiktaren', async () => {
    const { sida, fel } = await oppna(bokare.epost);
    await sida.click('#botten button[data-vy="lista"]');
    await sida.click('#manuellDorr2');
    await sida.fill('#mGata', 'Björkvägen');
    await sida.fill('#mNummer', '17');
    await sida.fill('#mPostort', 'Västerås');
    await sida.click('#mNasta');

    // Kunden ska inte kunna fyllas i förrän tiden är vald.
    await sida.waitForSelector(`.dagruta[data-dag="${MANDAG}"]`, { timeout: 10000 });
    assert.equal(await sida.$('#bFornamn'), null, 'kundfälten syns innan tiden är vald');

    await sida.click(`.dagruta[data-dag="${MANDAG}"]`);
    await sida.waitForSelector('.tidval-bes', { timeout: 10000 });
    await sida.click('.tidval-block:has(.tidval-tid:text-is("14:00")) .tidval-bes');

    await sida.waitForSelector('#bFornamn', { timeout: 10000 });
    await sida.fill('#bFornamn', 'Johan');
    await sida.fill('#bTelefon', '070-123 45 67');
    await sida.click('#bSpara');

    await sida.waitForFunction(() => !document.querySelector('#bSpara'), null, { timeout: 10000 }).catch(() => {});
    const rader = s.sql(`SELECT b.tid, b.saljare_id FROM bokningar b WHERE b.fornamn = 'Johan'`);
    assert.equal(rader.length, 1, 'bokningen sparades inte');
    assert.equal(rader[0].tid, '14:00');
    assert.equal(rader[0].saljare_id, karl.id);
    assert.deepEqual(fel, []);
    await sida.context().close();
  });

  it('Mötesbokare+ redigerar bokningen från Kommande: ny tid, samma bokning', async () => {
    const [fore] = s.sql(`SELECT id, tid FROM bokningar WHERE fornamn = 'Johan'`);
    assert.ok(fore, 'bokningen från förra testet saknas');
    const { sida, fel } = await oppna(plusBokare.epost);
    await sida.click('#botten button[data-vy="lista"]');
    await sida.click(`[data-bok="${fore.id}"]`);
    await sida.click('#bkRedigera');
    await sida.waitForSelector('#rbTider [data-tid="10:00"]', { timeout: 10000 });
    await sida.fill('#rbTelefon', '070-999 99 99');
    await sida.click('#rbTider [data-tid="10:00"]');
    await sida.click('#rbSpara');
    await sida.waitForFunction(() => !document.querySelector('#modalOverlay.open'), null, { timeout: 10000 })
      .catch(async (e) => { throw new Error(e.message + ' — ' + await sida.textContent('#rbFel')); });

    const efter = s.sql(`SELECT id, tid, telefon FROM bokningar WHERE fornamn = 'Johan'`);
    assert.equal(efter.length, 1, 'en ombokning ska inte skapa en ny bokning');
    assert.equal(efter[0].id, fore.id);
    assert.equal(efter[0].tid, '10:00');
    assert.equal(efter[0].telefon, '070-999 99 99');
    assert.deepEqual(fel, []);
    await sida.context().close();
  });

  it('Admin Besiktare blockerar en tid i schemats månadskalender, och besiktaren lägger till en', async () => {
    const vandTillDagen = async (sida) => {
      await sida.waitForSelector('.mkal', { timeout: 10000 });
      if (!(await sida.$(`.mkal-dag[data-dag="${MANDAG}"]`))) await sida.click('#tFram');
      await sida.click(`.mkal-dag[data-dag="${MANDAG}"]`);
    };

    const admin = await oppna(alma.epost);
    await admin.sida.click('#botten button[data-vy="bokningar"]');
    await admin.sida.click('#bokFlikar [data-bok="tider"]');
    await vandTillDagen(admin.sida);
    await admin.sida.click('[data-lage="blockera"]');
    await admin.sida.fill('#tOrsak', 'Tandläkare');
    await admin.sida.click('.tidruta[data-tid="12:00"]');
    await admin.sida.waitForFunction(() => document.querySelector('.tidruta[data-tid="12:00"]')?.classList.contains('blockerad'));
    await admin.sida.waitForSelector('#tStatus:not([hidden])');
    await admin.sida.waitForFunction(() => /Sparat/.test(document.querySelector('#tStatus')?.textContent || ''));
    const block = s.sql(`SELECT ledig, orsak FROM saljartider WHERE saljare_id = ? AND datum = ? AND tid = '12:00'`, karl.id, MANDAG);
    assert.deepEqual(block.map((r) => ({ ...r })), [{ ledig: 0, orsak: 'Tandläkare' }]);
    assert.deepEqual(admin.fel, []);
    await admin.sida.context().close();

    // Besiktaren i sitt eget schema: ett tryck på en tom tid lägger in den.
    const bes = await oppna(karl.epost);
    await bes.sida.click('#botten button[data-vy="bokningar"]');
    await bes.sida.click('#bokFlikar [data-bok="tider"]');
    await vandTillDagen(bes.sida);
    assert.equal(await bes.sida.$('#tSaljare'), null, 'besiktaren ska inte kunna välja någon annan');
    await bes.sida.click('.tidruta[data-tid="16:00"]');
    await bes.sida.waitForFunction(() => /Sparat/.test(document.querySelector('#tStatus')?.textContent || ''));
    const ny = s.sql(`SELECT ledig FROM saljartider WHERE saljare_id = ? AND datum = ? AND tid = '16:00'`, karl.id, MANDAG);
    assert.equal(ny.length && ny[0].ledig, 1);
    assert.deepEqual(bes.fel, []);
    await bes.sida.context().close();
  });

  it('tiden först: mötesbokaren väljer 14:00 och får dagarna och besiktaren som kan', async () => {
    const { sida, fel } = await oppna(bokare.epost);
    await sida.click('#botten button[data-vy="lista"]');
    await sida.click('#manuellDorr2');
    await sida.fill('#mGata', 'Tidsvägen');
    await sida.fill('#mNummer', '4b');
    await sida.fill('#mPostort', 'Västerås');
    await sida.click('#mNasta');
    await sida.waitForSelector('#bTidForst', { timeout: 10000 });
    await sida.selectOption('#bTidForst', '14:00');
    await sida.click(`[data-forst-dag="${MANDAG}"][data-bes="${karl.id}"]`);
    await sida.fill('#bFornamn', 'Tidfors');
    await sida.fill('#bTelefon', '070-444 44 44');
    await sida.click('#bSpara');
    await sida.waitForFunction(() => !document.querySelector('#bSpara'), null, { timeout: 10000 }).catch(() => {});
    const [rad] = s.sql(`SELECT b.datum, b.tid, b.saljare_id, a.nummer FROM bokningar b
      JOIN adresser a ON a.id = b.adress_id WHERE b.fornamn = 'Tidfors'`);
    assert.deepEqual({ ...rad }, { datum: MANDAG, tid: '14:00', saljare_id: karl.id, nummer: '4B' });
    assert.deepEqual(fel, []);
    await sida.context().close();
  });
});
