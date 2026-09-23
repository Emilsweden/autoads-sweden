/**
 * Kartan: allt den gör i fält, prövat i en riktig webbläsare.
 *
 * Samma prov körs för varje kartmotor appen kan använda. OpenStreetMap-kartan
 * (MapLibre) prövas alltid. Googles karta prövas bara när en testnyckel finns
 * i miljön — se MOTORER nedan — eftersom varje kartladdning hos Google räknas.
 *
 * OpenStreetMaps tjänster för husnummer och adresser låtsas testet själv vara,
 * så att proven inte beror på nätet: Overpass svarar med husen i FALT_HUS,
 * Nominatim svarar inte alls.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { starta } from './server.mjs';
import { anrop, nyttSystem, LOSENORD } from './hjalp.mjs';

async function hittaPlaywright() {
  for (const vag of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try { return await import(vag); } catch { /* prova nästa */ }
  }
  return null;
}
const pw = await hittaPlaywright();

/** Dörrar vi har registrerat, i Västerås, drygt 40 meter isär. */
const DORRAR = [
  { gata: 'Storgatan', nummer: '12', postort: 'Västerås', lat: 59.6100, lon: 16.5450 },
  { gata: 'Storgatan', nummer: '14', postort: 'Västerås', lat: 59.6104, lon: 16.5450 },
];

/** Hus som bara finns i OpenStreetMap — ingen har knackat på dem än. */
const FALT_HUS = [20, 22, 24].map((n, i) => ({
  type: 'node', id: 900 + i, lat: 59.6120 + i * 0.0003, lon: 16.5470,
  tags: { 'addr:street': 'Mineralgatan', 'addr:housenumber': String(n), 'addr:city': 'Västerås' },
}));

const MIN_POSITION = { latitude: 59.6102, longitude: 16.5449 };

const MOTORER = [{ namn: 'maplibre' }];

for (const motor of MOTORER) {
  describe(`kartan (${motor.namn})`, { skip: !pw && 'Playwright saknas' }, () => {
    let s, webblasare, bokare, chef;

    before(async () => {
      s = await starta(motor.config || {});
      const sys = await nyttSystem(s);
      chef = sys.admin;
      bokare = await sys.konto('Bea Bokare', 'saljare');
      const omr = (await anrop(s.url, 'omrade-spara', { namn: 'Västerås', ort: 'Västerås' }, chef.token)).id;
      await anrop(s.url, 'adresser-importera', { omrade_id: omr, adresser: DORRAR }, chef.token);
      webblasare = await pw.chromium.launch();
    });
    after(async () => {
      await webblasare?.close();
      await s.stang();
    });

    /** Öppnar appen som `epost`, med GPS på och OpenStreetMaps tjänster härmade. */
    async function oppna(epost) {
      const ctx = await webblasare.newContext({
        viewport: { width: 390, height: 844 }, serviceWorkers: 'block',
        geolocation: MIN_POSITION, permissions: ['geolocation'],
      });
      const sida = await ctx.newPage();
      const fel = [];
      sida.on('pageerror', (e) => fel.push(e.message));
      await sida.route('**/*', (r) => {
        const url = r.request().url();
        if (url.startsWith(s.url)) return r.continue();
        if (url.startsWith('https://overpass-api.de/')) {
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: FALT_HUS }) });
        }
        if (motor.tillat && motor.tillat.some((v) => url.startsWith(v))) return r.continue();
        return r.abort();
      });
      await sida.goto(s.url + '/');
      await sida.fill('#lEpost', epost);
      await sida.fill('#lLosen', LOSENORD);
      await sida.click('#lKnapp');
      await sida.waitForSelector('#app:not([hidden])', { timeout: 10000 });
      await vantaPaKarta(sida);
      return { sida, fel };
    }

    /*
     * Kartan nås genom window.__kartmotor, som ser likadan ut för båda
     * motorerna. Före motorbytet fanns bara MapLibre-kartan i window.__karta.
     */
    async function vantaPaKarta(sida) {
      await sida.waitForFunction(() => {
        const m = window.__kartmotor;
        if (m) return m.arKlar();
        const k = window.__karta;
        return !!(k && k.isStyleLoaded() && k.getSource('dorrar'));
      }, null, { timeout: 20000 });
    }

    async function flyg(sida, lon, lat, zoom) {
      await sida.evaluate(([lon, lat, zoom]) => {
        const m = window.__kartmotor;
        if (m) m.hoppa(lon, lat, zoom); else window.__karta.jumpTo({ center: [lon, lat], zoom });
      }, [lon, lat, zoom]);
      await sida.waitForTimeout(600);
    }

    /** Var på sidan en punkt på kartan hamnar, för att kunna trycka där. */
    async function sidpunkt(sida, lon, lat) {
      return sida.evaluate(([lon, lat]) => {
        const m = window.__kartmotor;
        const p = m ? m.pixel(lon, lat) : window.__karta.project([lon, lat]);
        const r = document.getElementById('karta').getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      }, [lon, lat]);
    }

    it('ett tryck på en registrerad dörr öppnar just den dörren', async () => {
      const { sida, fel } = await oppna(bokare.epost);
      const [d] = DORRAR;
      await flyg(sida, d.lon, d.lat, 18);
      const p = await sidpunkt(sida, d.lon, d.lat);
      await sida.mouse.click(p.x, p.y);
      await sida.waitForSelector('#dorrPanel .resultat', { timeout: 8000 });
      assert.match(await sida.textContent('#dorrPanel h2'), /Storgatan 12/);
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('husen som bara finns i OpenStreetMap får sitt nummer på kartan', async () => {
      const { sida, fel } = await oppna(bokare.epost);
      await flyg(sida, 16.5470, 59.6123, 17);
      await sida.waitForSelector('.hus-nummer', { timeout: 10000 });
      const nummer = await sida.$$eval('.hus-nummer', (n) => n.map((e) => e.textContent.trim()).sort());
      assert.deepEqual(nummer, ['20', '22', '24']);
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('ett tryck på ett husnummer skapar dörren och öppnar den — utan adressrutan', async () => {
      const { sida, fel } = await oppna(bokare.epost);
      await flyg(sida, 16.5470, 59.6123, 17);
      await sida.waitForSelector('.hus-nummer', { timeout: 10000 });
      await sida.click('.hus-nummer:text-is("22")');
      await sida.waitForSelector('#dorrPanel .resultat', { timeout: 8000 });
      assert.match(await sida.textContent('#dorrPanel h2'), /Mineralgatan 22/);
      assert.equal(await sida.$('.kartpopp'), null, 'adressrutan öppnades också');
      assert.equal(s.sql(`SELECT COUNT(*) AS n FROM adresser WHERE gata = 'Mineralgatan' AND nummer = '22'`)[0].n, 1);
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('ett tryck bredvid ett hus föreslår huset, och dörren skapas på husets plats', async () => {
      const { sida, fel } = await oppna(bokare.epost);
      const hus = FALT_HUS[2];                     // Mineralgatan 24
      await flyg(sida, hus.lon, hus.lat, 18);
      await sida.waitForSelector('.hus-nummer', { timeout: 10000 });
      const p = await sidpunkt(sida, hus.lon, hus.lat);
      await sida.mouse.click(p.x + 40, p.y);       // bredvid brickan, några meter från huset
      await sida.waitForSelector('.kartpopp .kartpopp-knapp', { timeout: 8000 });
      assert.match(await sida.textContent('.kartpopp b'), /Mineralgatan 24/);
      await sida.click('.kartpopp .kartpopp-knapp:text-is("Öppna dörren")');
      await sida.waitForSelector('#dorrPanel .resultat', { timeout: 8000 });
      const [rad] = s.sql(`SELECT lat, lon FROM adresser WHERE gata = 'Mineralgatan' AND nummer = '24'`);
      assert.ok(rad, 'dörren skapades inte');
      assert.ok(Math.abs(rad.lat - hus.lat) < 1e-6 && Math.abs(rad.lon - hus.lon) < 1e-6,
        'dörren hamnade där tummen var, inte på huset');
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('säljarens egen position syns som en punkt', async () => {
      const { sida, fel } = await oppna(bokare.epost);
      await sida.waitForSelector('.jag-punkt', { timeout: 10000 });
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('den som leder laget ser var säljarna är', async () => {
      await anrop(s.url, 'position', { lat: 59.6103, lon: 16.5455 }, bokare.token);
      const { sida, fel } = await oppna('admin@vt.test');
      await sida.waitForSelector('.saljar-etikett', { timeout: 10000 });
      assert.match(await sida.textContent('.saljar-etikett'), /Bea Bokare/);
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('kartan ritas med OpenFreeMaps stil, som ligger i appen själv', async (t) => {
      if (motor.namn !== 'maplibre') return t.skip('gäller OpenStreetMap-kartan');
      const { sida, fel } = await oppna(bokare.epost);
      const stil = await sida.evaluate(() => {
        const s = window.__karta.getStyle();
        return { kalla: s.sources.openmaptiles && s.sources.openmaptiles.url, lager: s.layers.map((l) => l.id) };
      });
      assert.equal(stil.kalla, 'https://tiles.openfreemap.org/planet');
      assert.ok(stil.lager.includes('husnummer'), 'husnumren saknas i stilen');
      // Dörrarna ligger överst — annars skyms de av husen i 3D.
      assert.equal(stil.lager.at(-1), 'dorrar');
      // Upphovsrätten ska synas alltid, även när kartdatan inte gick att hämta.
      const ratt = await sida.textContent('.maplibregl-ctrl-attrib');
      assert.match(ratt, /OpenStreetMap/);
      assert.match(ratt, /OpenFreeMap/);
      assert.deepEqual(fel, []);
      await sida.context().close();
    });

    it('adressökningen hittar våra dörrar även utan nät till servern', async () => {
      const { sida, fel } = await oppna(bokare.epost);
      await sida.route('**/api/adress-sok', (r) => r.abort());
      await sida.fill('#adressSok', 'Storgatan 14');
      await sida.waitForSelector('.adressok-traff', { timeout: 8000 });
      assert.match(await sida.textContent('.adressok-traff'), /Storgatan 14.*i registret/s);
      assert.deepEqual(fel, []);
      await sida.context().close();
    });
  });
}

describe('appen utan nät', () => {
  it('varje modul appen laddar finns i service workerns lista', async () => {
    // Saknas en fil där startar appen inte utan täckning: webbläsaren kan
    // inte hämta den, och då faller hela kedjan av import.
    const { readFileSync, readdirSync } = await import('node:fs');
    const sw = readFileSync(new URL('../falt/sw.js', import.meta.url), 'utf8');
    const skal = new Set([...sw.matchAll(/'\.\/(js\/[\w-]+\.js)'/g)].map((m) => m[1]));
    const statiska = readdirSync(new URL('../falt/js/', import.meta.url))
      .filter((f) => f.endsWith('.js'))
      .map((f) => 'js/' + f)
      // Laddas bara när Googles karta används, och Google fungerar ändå inte utan nät.
      .filter((f) => f !== 'js/kartmotor-google.js');
    const saknas = statiska.filter((f) => !skal.has(f));
    assert.deepEqual(saknas, [], 'saknas i SKAL i falt/sw.js: ' + saknas.join(', '));
  });

  it('kartstilen finns i service workerns lista', async () => {
    // Utan stilen startar inte kartan alls utan nät — inte ens dörrpunkterna.
    const { readFileSync } = await import('node:fs');
    const sw = readFileSync(new URL('../falt/sw.js', import.meta.url), 'utf8');
    assert.match(sw, /'\.\/kartstil\/liberty\.json'/);
  });
});
