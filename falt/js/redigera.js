/**
 * Redigera bokning — samma formulär var bokningen än öppnas: från dörren,
 * kalendern, Kommande eller Bokade adresser.
 *
 * Allt går att ändra på ett ställe: kund, telefon, adress, lägenhet, datum,
 * tid och besiktare. Bokningen behåller sitt id; flyttas den räknar servern
 * om samma regler som vid en ny bokning och antingen flyttas den eller står
 * den kvar orörd.
 *
 * Knapparna Avboka och Radera visas efter flaggorna servern skickar på
 * bokningen (far_avboka, far_radera) — servern kontrollerar samma sak igen.
 */

import { anrop } from './api.js';
import { $, esc, toast, oppnaPanel, stangPanel, visaDatum } from './ui.js';
import { dataAndrad } from './state.js';

/**
 * Öppnar formuläret för bokningen `b`. `adress` används när bokningsraden
 * saknar gata och nummer (dörrens egna bokningar). `klar` anropas när något
 * sparats, avbokats eller raderats; `tillbaka` när man avbryter.
 */
export function redigeraBokning(b, { adress, panel = 'modal', klar, tillbaka } = {}) {
  const gata = b.gata || (adress && adress.gata) || '';
  const nummer = b.nummer || (adress && adress.nummer) || '';
  const postort = b.postort || (adress && adress.postort) || '';

  oppnaPanel(panel,
    '<h2>Redigera bokning</h2>' +
    '<p class="sub">' + esc([gata + ' ' + nummer, postort].filter((x) => x.trim()).join(', ')) + '</p>' +
    '<div class="rad2" style="margin-top:14px">' +
    falt('rbFornamn', 'Förnamn', b.fornamn, 'given-name') +
    falt('rbEfternamn', 'Efternamn', b.efternamn, 'family-name') +
    '</div>' +
    '<div class="field"><label for="rbTelefon">Mobilnummer</label>' +
    '<input id="rbTelefon" type="tel" inputmode="tel" value="' + esc(b.telefon || '') + '"></div>' +
    '<div class="rad2">' +
    falt('rbGata', 'Gata', gata, 'address-line1') +
    '<div class="field"><label for="rbNummer">Husnummer</label>' +
    // Text, inte siffror: 12A och 12b är egna adresser.
    '<input id="rbNummer" type="text" autocapitalize="characters" value="' + esc(nummer) + '"></div>' +
    '</div>' +
    '<div class="rad2">' +
    falt('rbPostort', 'Ort', postort, 'address-level2') +
    falt('rbLagenhet', 'Lägenhet', b.lagenhet, 'off') +
    '</div>' +
    '<div class="field"><label for="rbDatum">Datum</label>' +
    '<input id="rbDatum" type="date" value="' + esc(b.datum || '') + '"></div>' +
    '<h3>Tid</h3><div id="rbTider" class="chips tider">Hämtar tider…</div>' +
    '<div class="field" id="rbBesRad" hidden style="margin-top:14px"><label for="rbBesiktare">Besiktare</label>' +
    '<select id="rbBesiktare"></select></div>' +
    '<div class="field" style="margin-top:14px"><label for="rbKomm">Anteckning</label>' +
    '<textarea id="rbKomm">' + esc(b.kommentar || '') + '</textarea></div>' +
    '<div class="err" id="rbFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="rbTillbaka">Tillbaka</button>' +
    '<button class="btn btn-primary" id="rbSpara">Spara</button></div>' +
    '<div class="btn-rad">' +
    (b.far_avboka ? '<button class="btn btn-ghost" id="rbAvboka">Avboka mötet</button>' : '') +
    (b.far_radera ? '<button class="btn btn-fara" id="rbRadera">Radera bokningen</button>' : '') +
    '</div>');

  let valdTid = b.tid || '';
  let valdBes = b.saljare_id || '';
  let perTid = {};          // tid → [{ id, namn }] som kan ta den

  /* Tiderna kommer från servern, med bokningen själv borträknad — den ska
     inte stå i vägen för att flytta en halvtimme. */
  async function laddaTider() {
    const ruta = $('rbTider');
    const dat = $('rbDatum').value;
    if (!dat) { ruta.innerHTML = '<span class="sub">Välj ett datum.</span>'; return; }
    ruta.textContent = 'Hämtar tider…';
    try {
      // Bokningens adress avgör vilka besiktare som jobbar där.
      const svar = await anrop('bokbara-tider', { datum: dat, utom: b.id, adress_id: b.adress_id });
      perTid = {};
      (svar.tider || []).forEach((t) => { perTid[t.tid] = t.besiktare; });
      // Bokningens egen tid finns kvar att behålla, även om ingen annan kan ta den.
      if (dat === b.datum && b.tid && !perTid[b.tid]) {
        perTid[b.tid] = b.saljare_id ? [{ id: b.saljare_id, namn: b.saljare || 'Nuvarande besiktare' }] : [];
      }
      const tider = Object.keys(perTid).sort();
      if (!tider.includes(valdTid)) valdTid = '';
      ruta.innerHTML = tider.map((t) => '<button class="chip' + (t === valdTid ? ' vald' : '') +
        '" data-tid="' + esc(t) + '">' + esc(t) + '</button>').join('') ||
        '<span class="sub">Ingen ledig tid ' + esc(visaDatum(dat)) + '.</span>';
      ruta.querySelectorAll('[data-tid]').forEach((k) => {
        k.onclick = () => {
          valdTid = k.dataset.tid;
          ruta.querySelectorAll('.chip').forEach((x) => x.classList.toggle('vald', x === k));
          ritaBesiktare();
        };
      });
    } catch (e) {
      ruta.innerHTML = '<span class="sub">Kunde inte hämta tider: ' + esc(e.message) + '</span>';
    }
    ritaBesiktare();
  }

  /* Besiktarna som kan ta den valda tiden. Den som inte får byta besiktare
     ser inget val — mötet stannar hos sin. */
  function ritaBesiktare() {
    const rad = $('rbBesRad');
    const lista = perTid[valdTid] || [];
    if (!b.far_byt_besiktare || !valdTid || !lista.length) { rad.hidden = true; return; }
    if (!lista.some((x) => x.id === valdBes)) valdBes = lista[0].id;
    $('rbBesiktare').innerHTML = lista.map((x) => '<option value="' + esc(x.id) + '"' +
      (x.id === valdBes ? ' selected' : '') + '>' + esc(x.namn) + '</option>').join('');
    $('rbBesiktare').onchange = () => { valdBes = $('rbBesiktare').value; };
    rad.hidden = lista.length < 2 && lista[0].id === b.saljare_id;
  }

  laddaTider();
  $('rbDatum').onchange = () => { valdTid = ''; laddaTider(); };

  $('rbTillbaka').onclick = () => (tillbaka ? tillbaka() : stangPanel(panel));

  $('rbSpara').onclick = async () => {
    const knapp = $('rbSpara');
    const data = {
      id: b.id,
      fornamn: $('rbFornamn').value.trim(),
      efternamn: $('rbEfternamn').value.trim(),
      telefon: $('rbTelefon').value.trim(),
      lagenhet: $('rbLagenhet').value.trim(),
      kommentar: $('rbKomm').value.trim(),
      datum: $('rbDatum').value,
      tid: valdTid,
    };
    if (!data.fornamn || !data.telefon) { $('rbFel').textContent = 'Förnamn och mobilnummer krävs.'; return; }
    if (data.datum && !data.tid) { $('rbFel').textContent = 'Välj en tid.'; return; }
    // Adressen skickas bara om den ändrats — annars pekas bokningen inte om.
    const nyGata = $('rbGata').value.trim();
    const nyttNummer = $('rbNummer').value.trim().replace(/\s+/g, '');
    const nyOrt = $('rbPostort').value.trim();
    if (nyGata !== gata || nyttNummer !== nummer || nyOrt !== postort) {
      Object.assign(data, { gata: nyGata, nummer: nyttNummer, postort: nyOrt });
    }
    if (b.far_byt_besiktare && valdBes && valdBes !== b.saljare_id) data.saljare_id = valdBes;

    await upptagen(knapp, 'Sparar…', async () => {
      try {
        await anrop('bokning-andra', data);
        toast('Bokningen är ändrad ✓');
        dataAndrad();
        if (klar) klar(); else stangPanel(panel);
      } catch (e) {
        $('rbFel').textContent = e.message;
        if (e.status === 409) laddaTider();
      }
    });
  };

  if ($('rbAvboka')) {
    $('rbAvboka').onclick = () => upptagen($('rbAvboka'), 'Avbokar…', async () => {
      if (!confirm('Avboka mötet? Tiden blir ledig igen.')) return;
      try {
        await anrop('bokning-status', { id: b.id, status: 'avbokad' });
        toast('Mötet är avbokat — tiden är ledig igen');
        dataAndrad();
        if (klar) klar(); else stangPanel(panel);
      } catch (e) { $('rbFel').textContent = e.message; }
    });
  }
  if ($('rbRadera')) {
    $('rbRadera').onclick = () => upptagen($('rbRadera'), 'Raderar…', async () => {
      if (!confirm('Radera bokningen helt? Kommentarer och bilder försvinner med den. Det går inte att ångra.')) return;
      try {
        await anrop('bokning-ta-bort', { id: b.id });
        toast('Bokningen är raderad');
        dataAndrad();
        if (klar) klar(); else stangPanel(panel);
      } catch (e) { $('rbFel').textContent = e.message; }
    });
  }
}

const falt = (id, etikett, varde, auto) =>
  '<div class="field"><label for="' + id + '">' + esc(etikett) + '</label>' +
  '<input id="' + id + '" type="text" autocomplete="' + auto + '" value="' + esc(varde || '') + '"></div>';

/**
 * Knappen säger vad som händer och går inte att trycka på igen förrän
 * servern svarat — två tryck på Spara ska inte bli två ändringar.
 */
async function upptagen(knapp, text, fn) {
  if (knapp.disabled) return;
  const forut = knapp.textContent;
  knapp.disabled = true;
  knapp.textContent = text;
  try { await fn(); } finally {
    if (knapp.isConnected) { knapp.disabled = false; knapp.textContent = forut; }
  }
}
