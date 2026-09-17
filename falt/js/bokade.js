/**
 * Bokade adresser — en gemensam sida för alla bokningar, oavsett vem som
 * bokade. Vad var och en ser avgörs på servern: mötesbokaren sina bokningar,
 * säljaren sina möten, Mötesbokare+ och Admin Säljare alla. Här skrivs
 * kommentarer, återkoppling och bilder från telefonen.
 */

import { anrop } from './api.js';
import { $, esc, toast, oppnaPanel, stangPanel, visaDatum, visaTidpunkt, idag } from './ui.js';
import { S, arRoll, kan, dataAndrad } from './state.js';

/* Bilderna skalas ner innan de skickas: en telefonbild är flera megabyte,
   och det som behövs är att man ser taket. */
const BILD_MAX_KANT = 1400;
const BILD_KVALITET = 0.72;

let bokningar = [];
let utfallstext = {};
let filter = 'kommande';
let oppen = null;      // id på den bokning som är utfälld

export async function rita() {
  const ruta = $('bokadeInnehall');
  if (!ruta) return;
  if (!bokningar.length) ruta.innerHTML = '<div class="tom">Hämtar bokningar…</div>';

  try {
    const svar = await anrop('bokade-adresser', {});
    bokningar = svar.bokningar || [];
    utfallstext = svar.utfall || utfallstext;
  } catch (e) {
    ruta.innerHTML = '<div class="tom">Kunde inte hämta bokningarna: ' + esc(e.message) + '</div>';
    return;
  }
  ritaLista();
}

function urval() {
  const nu = idag();
  if (filter === 'kommande') return bokningar.filter((b) => (b.datum || '9999') >= nu && b.status === 'bokad');
  if (filter === 'genomforda') return bokningar.filter((b) => b.status === 'genomford');
  return bokningar;
}

function ritaLista() {
  const ruta = $('bokadeInnehall');
  const lista = urval();

  if (S.vy === 'bokningar') {
    $('vySub').textContent = bokningar.length + ' bokade adresser';
  }

  ruta.innerHTML = '<div class="flikar" id="bokadeFlikar">' +
    [['kommande', 'Kommande'], ['genomforda', 'Genomförda'], ['alla', 'Alla']]
      .map(([k, t]) => '<button class="flik' + (filter === k ? ' aktiv' : '') +
        '" data-filter="' + k + '">' + t + '</button>').join('') +
    '</div>' +
    (lista.length
      ? '<div class="bokade">' + lista.map(kort).join('') + '</div>'
      : '<div class="tom">Inga bokningar här.</div>');

  ruta.querySelectorAll('[data-filter]').forEach((k) => {
    k.onclick = () => { filter = k.dataset.filter; ritaLista(); };
  });
  ruta.querySelectorAll('[data-oppna]').forEach((k) => {
    k.onclick = () => { oppen = oppen === k.dataset.oppna ? null : k.dataset.oppna; ritaLista(); };
  });
  ruta.querySelectorAll('[data-komm]').forEach((k) => { k.onclick = () => skrivKommentar(k.dataset.komm); });
  ruta.querySelectorAll('[data-bild]').forEach((k) => { k.onclick = () => valjBild(k.dataset.bild); });
  ruta.querySelectorAll('[data-visa]').forEach((k) => { k.onclick = () => visaBild(k.dataset.visa); });
  ruta.querySelectorAll('[data-genomford]').forEach((k) => {
    k.onclick = () => sattStatus(k.dataset.genomford, 'genomford');
  });
  ruta.querySelectorAll('[data-ater]').forEach((k) => { k.onclick = () => skrivAterkoppling(k.dataset.ater); });
}

function kort(b) {
  const utfalld = oppen === b.id;
  const kund = b.kund || 'Kund saknas';
  return '<div class="bokad-kort' + (utfalld ? ' oppen' : '') + '">' +
    '<button class="bokad-topp" data-oppna="' + esc(b.id) + '">' +
    '<span class="bokad-tid"><b>' + esc(visaDatum(b.datum) || '—') + '</b><span>' + esc(b.tid || '') + '</span></span>' +
    '<span class="bokad-mitt"><b>' + esc(b.adress || '—') + '</b>' +
    '<span>' + esc(kund) + (b.postort ? ' · ' + esc(b.postort) : '') + '</span></span>' +
    '<span class="bokad-hoger">' +
    (b.aterkoppling && b.aterkoppling.length
      ? '<span class="bokad-antal">' + esc(b.aterkoppling[b.aterkoppling.length - 1].utfall_text) + '</span>' : '') +
    (b.kommentarer.length ? '<span class="bokad-antal">' + b.kommentarer.length + ' 💬</span>' : '') +
    (b.bilagor.length ? '<span class="bokad-antal">' + b.bilagor.length + ' 📷</span>' : '') +
    '<span class="märke m-' + (b.status === 'genomford' ? 'bokat' : 'aterkom') + '">' +
    (b.status === 'genomford' ? 'GENOMFÖRD' : 'BOKAD') + '</span></span>' +
    '</button>' +
    (utfalld ? detaljer(b) : '') +
    '</div>';
}

function detaljer(b) {
  const telefon = (b.telefon || '').replace(/[^\d+]/g, '');
  return '<div class="bokad-detalj">' +
    '<div class="bokad-fakta">' +
    rad('Kund', b.kund) +
    rad('Telefon', b.telefon) +
    rad('Adress', [b.adress, b.postort].filter(Boolean).join(', ')) +
    rad('Tid', [visaDatum(b.datum), b.tid && 'kl. ' + b.tid].filter(Boolean).join(' ')) +
    rad('Bokad av', b.bokare) +
    rad('Säljare', b.saljare) +
    rad('Område', b.omrade) +
    (b.kommentar ? rad('Från bokningen', b.kommentar) : '') +
    '</div>' +
    '<div class="btn-rad">' +
    (telefon ? '<a class="btn btn-primary" href="tel:' + esc(telefon) + '">Ring kund</a>' : '') +
    (b.status !== 'genomford'
      ? '<button class="btn btn-ghost" data-genomford="' + esc(b.id) + '">Markera genomförd</button>' : '') +
    '</div>' +

    '<h3>Utfall</h3>' +
    ((b.aterkoppling && b.aterkoppling.length)
      ? '<div class="komm-lista">' + b.aterkoppling.map((a) =>
        '<div class="komm utfall"><div class="komm-topp"><b>' + esc(a.utfall_text) + '</b>' +
        (a.belopp ? ' · ' + esc(String(a.belopp)) + ' kr' : '') +
        ' · ' + esc(a.forfattare || 'Okänd') + ' · ' + esc(visaTidpunkt(a.skapad)) + '</div>' +
        esc(a.text || '') + '</div>').join('') + '</div>'
      : '<p class="sub">Ingen återkoppling än.</p>') +
    (kan('aterkoppla')
      ? '<button class="btn btn-ghost" data-ater="' + esc(b.id) + '">Återkoppla på mötet</button>' : '') +

    '<h3>Kommentarer</h3>' +
    (b.kommentarer.length
      ? '<div class="komm-lista">' + b.kommentarer.map((k) =>
        '<div class="komm"><div class="komm-topp">' + esc(k.forfattare || 'Okänd') +
        (k.roll === 'besiktare' ? ' · säljare' : '') +
        ' · ' + esc(visaTidpunkt(k.skapad)) + '</div>' + esc(k.text) + '</div>').join('') + '</div>'
      : '<p class="sub">Inga kommentarer än.</p>') +
    '<button class="btn btn-ghost" data-komm="' + esc(b.id) + '">Skriv kommentar</button>' +

    '<h3>Bilder</h3>' +
    (b.bilagor.length
      ? '<div class="bild-rutnat">' + b.bilagor.map((f) =>
        '<button class="bild-ruta" data-visa="' + esc(f.id) + '">' +
        '<span>' + esc(f.namn || 'Bild') + '</span></button>').join('') + '</div>'
      : '<p class="sub">Inga bilder än.</p>') +
    '<button class="btn btn-ghost" data-bild="' + esc(b.id) + '">Lägg till bild</button>' +
    '</div>';
}

const rad = (etikett, varde) => (varde
  ? '<div class="fakta-rad"><span>' + esc(etikett) + '</span><b>' + esc(varde) + '</b></div>' : '');

/* ── Kommentarer ── */

function skrivKommentar(id) {
  const b = bokningar.find((x) => x.id === id);
  oppnaPanel('modal',
    '<h2>Kommentar</h2><p class="sub">' + esc((b && b.adress) || '') +
    (b && b.kund ? ' · ' + esc(b.kund) : '') + '</p>' +
    '<div class="field" style="margin-top:14px"><label for="kText">Vad ska laget veta?</label>' +
    '<textarea id="kText" rows="5" placeholder="T.ex. ägaren är hemma efter 17, hunden skäller men är snäll"></textarea></div>' +
    '<div class="err" id="kFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="kAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="kSpara">Spara</button></div>');

  $('kAvbryt').onclick = () => stangPanel('modal');
  $('kSpara').onclick = async () => {
    const text = $('kText').value.trim();
    if (!text) { $('kFel').textContent = 'Skriv något först.'; return; }
    $('kSpara').textContent = 'Sparar…';
    try {
      await anrop('bokning-kommentar', { bokning_id: id, text });
      stangPanel('modal');
      toast('Kommentaren är sparad ✓');
      await rita();
    } catch (e) {
      $('kSpara').textContent = 'Spara';
      $('kFel').textContent = e.message;
    }
  };
}

/* ── Återkoppling ── */

/**
 * Säljaren berättar hur mötet gick. Den som bokade får se det på sin
 * bokning — det är hela poängen med att den hör ihop med bokningen.
 */
function skrivAterkoppling(id) {
  const b = bokningar.find((x) => x.id === id);
  const val = Object.entries(utfallstext).length
    ? Object.entries(utfallstext)
    : [['salt', 'Sålt'], ['ej_salt', 'Inte sålt'], ['uppfoljning', 'Uppföljning'], ['uteblev', 'Kunden uteblev']];

  oppnaPanel('modal',
    '<h2>Hur gick mötet?</h2><p class="sub">' + esc((b && b.adress) || '') +
    (b && b.kund ? ' · ' + esc(b.kund) : '') + '</p>' +
    '<div class="field" style="margin-top:14px"><label for="aUtfall">Utfall</label>' +
    '<select id="aUtfall">' + val.map(([k, t]) =>
      '<option value="' + esc(k) + '">' + esc(t) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="aBelopp">Ordervärde (kr, valfritt)</label>' +
    '<input id="aBelopp" type="number" inputmode="numeric" placeholder="t.ex. 180000"></div>' +
    '<div class="field"><label for="aText">Kommentar</label>' +
    '<textarea id="aText" rows="4" placeholder="T.ex. tegeltak, vill ha offert på hela taket"></textarea></div>' +
    '<div class="err" id="aFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="aAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="aSpara">Spara</button></div>');

  $('aAvbryt').onclick = () => stangPanel('modal');
  $('aSpara').onclick = async () => {
    $('aSpara').textContent = 'Sparar…';
    try {
      await anrop('aterkoppling-spara', {
        bokning_id: id,
        utfall: $('aUtfall').value,
        belopp: $('aBelopp').value || undefined,
        text: $('aText').value.trim(),
      });
      stangPanel('modal');
      toast('Återkopplingen är sparad ✓');
      await rita();
      dataAndrad();
    } catch (e) {
      $('aSpara').textContent = 'Spara';
      $('aFel').textContent = e.message;
    }
  };
}

/* ── Bilder ── */

/** Skalar ner bilden i telefonen — en originalbild är alldeles för stor. */
function skalaNer(fil) {
  return new Promise((klar, fel) => {
    const las = new FileReader();
    las.onerror = () => fel(new Error('Kunde inte läsa bilden'));
    las.onload = () => {
      const bild = new Image();
      bild.onerror = () => fel(new Error('Filen är ingen bild'));
      bild.onload = () => {
        const skala = Math.min(1, BILD_MAX_KANT / Math.max(bild.width, bild.height));
        const duk = document.createElement('canvas');
        duk.width = Math.round(bild.width * skala);
        duk.height = Math.round(bild.height * skala);
        duk.getContext('2d').drawImage(bild, 0, 0, duk.width, duk.height);
        klar(duk.toDataURL('image/jpeg', BILD_KVALITET));
      };
      bild.src = las.result;
    };
    las.readAsDataURL(fil);
  });
}

function valjBild(id) {
  const val = document.createElement('input');
  val.type = 'file';
  val.accept = 'image/*';
  val.multiple = true;
  val.onchange = async () => {
    const filer = [...(val.files || [])].slice(0, 10);
    if (!filer.length) return;
    toast(filer.length > 1 ? 'Laddar upp ' + filer.length + ' bilder…' : 'Laddar upp bilden…');
    let klara = 0;
    for (const fil of filer) {
      try {
        const data = await skalaNer(fil);
        await anrop('bokning-bilaga', { bokning_id: id, data, namn: fil.name, typ: 'image/jpeg' });
        klara++;
      } catch (e) {
        toast('Kunde inte lägga till ' + fil.name + ': ' + e.message);
      }
    }
    if (klara) { toast(klara + (klara > 1 ? ' bilder tillagda ✓' : ' bild tillagd ✓')); await rita(); }
  };
  val.click();
}

async function visaBild(id) {
  oppnaPanel('modal', '<h2>Bild</h2><p class="sub">Hämtar…</p>');
  try {
    const svar = await anrop('bilaga', { id });
    const f = svar.bilaga;
    oppnaPanel('modal',
      '<h2>' + esc(f.namn || 'Bild') + '</h2>' +
      '<p class="sub">' + esc(visaTidpunkt(f.skapad)) + '</p>' +
      '<img class="bild-stor" src="' + esc(f.data) + '" alt="' + esc(f.namn || 'Bild') + '">' +
      '<div class="btn-rad"><button class="btn btn-ghost" id="bStang">Stäng</button>' +
      '<button class="btn btn-ghost" id="bTaBort">Ta bort bilden</button></div>');
    $('bStang').onclick = () => stangPanel('modal');
    $('bTaBort').onclick = async () => {
      if (!confirm('Ta bort bilden?')) return;
      try {
        await anrop('bilaga-ta-bort', { id });
        stangPanel('modal');
        toast('Bilden är borttagen');
        await rita();
      } catch (e) { toast(e.message); }
    };
  } catch (e) {
    oppnaPanel('modal', '<h2>Bild</h2><p class="sub">' + esc(e.message) + '</p>');
  }
}

async function sattStatus(id, status) {
  try {
    await anrop('bokning-status', { id, status });
    toast('Bokningen är markerad som genomförd ✓');
    await rita();
    dataAndrad();
  } catch (e) { toast(e.message); }
}
