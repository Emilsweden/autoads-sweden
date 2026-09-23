/**
 * Bokade adresser — en gemensam sida för alla bokningar, oavsett vem som
 * bokade. Vad var och en ser avgörs på servern: mötesbokaren sina bokningar,
 * säljaren sina möten, Mötesbokare+ och Admin Säljare alla. Här skrivs
 * kommentarer, återkoppling och bilder från telefonen.
 */

import { anrop } from './api.js';
import { $, esc, toast, oppnaPanel, stangPanel, visaDatum, visaTidpunkt, idag } from './ui.js';
import { S, arRoll, kan, dataAndrad } from './state.js';
import { redigeraBokning } from './redigera.js';

/* Bilderna skalas ner innan de skickas: en telefonbild är flera megabyte,
   och det som behövs är att man ser taket. */
const BILD_MAX_KANT = 1400;
const BILD_KVALITET = 0.72;

let bokningar = [];
let utfallstext = {};
let filter = 'kommande';
let filterValt = false;   // har användaren själv valt flik? Annars visas det som väntar först
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
  if (filter === 'omdome') return bokningar.filter((b) => b.lamna_omdome);
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

  // Möten som väntar på omdöme får en egen flik först — det är det som ska göras.
  const vantar = bokningar.filter((b) => b.lamna_omdome).length;
  if (filter === 'omdome' && !vantar) filter = 'kommande';
  if (vantar && !filterValt) filter = 'omdome';
  ruta.innerHTML = '<div class="flikar" id="bokadeFlikar">' +
    (vantar ? [['omdome', 'Lämna omdöme (' + vantar + ')']] : [])
      .concat([['kommande', 'Kommande'], ['genomforda', 'Genomförda'], ['alla', 'Alla']])
      .map(([k, t]) => '<button class="flik' + (filter === k ? ' aktiv' : '') +
        '" data-filter="' + k + '">' + t + '</button>').join('') +
    '</div>' +
    (lista.length
      ? '<div class="bokade">' + lista.map(kort).join('') + '</div>'
      : '<div class="tom">Inga bokningar här.</div>');

  ruta.querySelectorAll('[data-filter]').forEach((k) => {
    k.onclick = () => { filter = k.dataset.filter; filterValt = true; ritaLista(); };
  });
  ruta.querySelectorAll('[data-oppna]').forEach((k) => {
    k.onclick = () => { oppen = oppen === k.dataset.oppna ? null : k.dataset.oppna; ritaLista(); };
  });
  ruta.querySelectorAll('[data-komm]').forEach((k) => { k.onclick = () => skrivKommentar(k.dataset.komm); });
  ruta.querySelectorAll('[data-bild]').forEach((k) => { k.onclick = () => valjBild(k.dataset.bild); });
  ruta.querySelectorAll('[data-visa]').forEach((k) => { k.onclick = () => visaBild(k.dataset.visa); });
  ruta.querySelectorAll('[data-ater]').forEach((k) => { k.onclick = () => lamnaOmdome(k.dataset.ater); });
  ruta.querySelectorAll('[data-redigera]').forEach((k) => {
    const b = bokningar.find((x) => x.id === k.dataset.redigera);
    k.onclick = () => redigeraBokning(b, { klar: () => { stangPanel('modal'); rita(); } });
  });
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
    '<span class="märke m-' + (b.lamna_omdome ? 'aterkom' : b.status === 'genomford' ? 'bokat'
      : b.status === 'ej_genomford' ? 'nej' : 'ejsvar') + '">' +
    (b.lamna_omdome ? 'LÄMNA OMDÖME' : b.status === 'genomford' ? 'GENOMFÖRD'
      : b.status === 'ej_genomford' ? 'EJ GENOMFÖRD' : 'BOKAD') + '</span></span>' +
    '</button>' +
    (utfalld ? detaljer(b) : '') +
    '</div>';
}

/** Ett omdöme som det lämnades: svaret på "genomfördes den?" och resten. */
function omdomeHtml(a) {
  const jaNej = (v) => (v === 1 ? 'Ja' : v === 0 ? 'Nej' : null);
  return '<div class="komm utfall"><div class="komm-topp"><b>' + esc(a.utfall_text) + '</b>' +
    ' · ' + esc(a.forfattare || 'Okänd') + ' · ' + esc(visaTidpunkt(a.skapad)) + '</div>' +
    (a.vad_hande ? '<div><b>Vad hände:</b> ' + esc(a.vad_hande) + '</div>' : '') +
    (jaNej(a.intresserad) ? '<div><b>Intresserad:</b> ' + jaNej(a.intresserad) + '</div>' : '') +
    (jaNej(a.blev_jobb) ? '<div><b>Blev det jobb:</b> ' + jaNej(a.blev_jobb) +
      (a.belopp ? ' · ' + esc(Number(a.belopp).toLocaleString('sv-SE')) + ' kr' : '') + '</div>' : '') +
    (a.text ? '<div>' + esc(a.text) + '</div>' : '') + '</div>';
}

function detaljer(b) {
  const telefon = (b.telefon || '').replace(/[^\d+]/g, '');
  const omdomen = b.aterkoppling || [];
  const senaste = omdomen[omdomen.length - 1];
  return '<div class="bokad-detalj">' +
    (b.lamna_omdome
      ? '<button class="btn btn-primary omdome-knapp" data-ater="' + esc(b.id) + '">Lämna omdöme</button>' : '') +
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
    (b.far_andra ? '<button class="btn btn-ghost" data-redigera="' + esc(b.id) + '">Redigera bokning</button>' : '') +
    '</div>' +

    '<h3>Omdöme</h3>' +
    (senaste ? omdomeHtml(senaste) : '<p class="sub">' +
      (b.lamna_omdome ? 'Mötet har börjat — lämna omdöme när du är klar.' : 'Inget omdöme än.') + '</p>') +
    (omdomen.length > 1
      ? '<details class="tidigare"><summary>Tidigare omdömen (' + (omdomen.length - 1) + ')</summary>' +
        omdomen.slice(0, -1).reverse().map(omdomeHtml).join('') + '</details>' : '') +
    (b.far_omdome && senaste && !b.lamna_omdome
      ? '<button class="btn btn-ghost" data-ater="' + esc(b.id) + '">Ändra omdöme</button>' : '') +

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
const ORSAKER = [
  ['ingen_hemma', 'Ingen hemma'],
  ['avbokade', 'Kunden avbokade'],
  ['ombokad', 'Kunden ringde och bokade om'],
  ['annat', 'Annat'],
];

/**
 * Lämna omdöme. Första frågan avgör resten: blev mötet av, och i så fall
 * hur — eller varför inte. Ett nytt omdöme ersätter inte det gamla; båda
 * står kvar, och det senaste gäller.
 */
function lamnaOmdome(id) {
  const b = bokningar.find((x) => x.id === id);
  if (!b) return;
  const forra = (b.aterkoppling || [])[b.aterkoppling.length - 1] || {};
  const val = {
    genomford: forra.genomford === 0 ? false : forra.genomford === 1 ? true : null,
    orsak: forra.orsak || '',
    intresserad: forra.intresserad === 1 ? true : forra.intresserad === 0 ? false : null,
    blev_jobb: forra.blev_jobb === 1 ? true : forra.blev_jobb === 0 ? false : null,
  };
  const jaNej = (namn) => '<div class="jn" data-jn="' + namn + '">' +
    '<button type="button" data-v="1" class="' + (val[namn] === true ? 'vald' : '') + '">Ja</button>' +
    '<button type="button" data-v="0" class="' + (val[namn] === false ? 'vald' : '') + '">Nej</button></div>';

  const panel = oppnaPanel('modal',
    '<h2>Lämna omdöme</h2><p class="sub">' + esc(b.adress || '') + (b.kund ? ' · ' + esc(b.kund) : '') +
    (b.datum ? ' · ' + esc(visaDatum(b.datum)) + (b.tid ? ' kl. ' + esc(b.tid) : '') : '') + '</p>' +
    '<h3>Genomfördes bokningen?</h3>' + jaNej('genomford') +
    '<div id="oJa" hidden>' +
    '<div class="field"><label for="oVad">Vad hände?</label>' +
    '<textarea id="oVad" rows="3" placeholder="T.ex. gick upp på taket, visade skadorna">' + esc(forra.vad_hande || '') + '</textarea></div>' +
    '<h3>Var kunden intresserad?</h3>' + jaNej('intresserad') +
    '<h3>Blev det jobb?</h3>' + jaNej('blev_jobb') +
    '<div class="field" id="oBeloppRad" hidden><label for="oBelopp">Ordervärde (kr, valfritt)</label>' +
    '<input id="oBelopp" type="number" inputmode="numeric" placeholder="t.ex. 180000" value="' + esc(forra.belopp || '') + '"></div>' +
    '</div>' +
    '<div id="oNej" hidden><h3>Varför inte?</h3><div class="chips" id="oOrsaker">' +
    ORSAKER.map(([k, t]) => '<button type="button" class="chip' + (val.orsak === k ? ' vald' : '') +
      '" data-orsak="' + k + '">' + esc(t) + '</button>').join('') + '</div>' +
    (b.far_andra ? '<button type="button" class="btn btn-ghost" id="oFlytta" hidden style="margin-top:10px">Flytta bokningen till en ny tid</button>' : '') +
    '</div>' +
    '<div class="field" style="margin-top:14px"><label for="oText">Anteckningar</label>' +
    '<textarea id="oText" rows="3" placeholder="Allt som är bra att veta">' + esc(forra.text || '') + '</textarea></div>' +
    '<p class="sub">Kommentarer och bilder lägger du till på bokningen — de syns för Admin Besiktare och Mötesbokare+.</p>' +
    '<div class="err" id="oFel"></div>' +
    '<div class="btn-rad"><button class="btn btn-ghost" id="oAvbryt">Avbryt</button>' +
    '<button class="btn btn-primary" id="oSpara">Spara omdöme</button></div>');

  const visa = () => {
    $('oJa').hidden = val.genomford !== true;
    $('oNej').hidden = val.genomford !== false;
    $('oBeloppRad').hidden = val.blev_jobb !== true;
    if ($('oFlytta')) $('oFlytta').hidden = val.orsak !== 'ombokad';
  };
  panel.querySelectorAll('[data-jn]').forEach((grupp) => {
    grupp.querySelectorAll('button').forEach((k) => {
      k.onclick = () => {
        val[grupp.dataset.jn] = k.dataset.v === '1';
        grupp.querySelectorAll('button').forEach((x) => x.classList.toggle('vald', x === k));
        visa();
      };
    });
  });
  $('oOrsaker').querySelectorAll('[data-orsak]').forEach((k) => {
    k.onclick = () => {
      val.orsak = k.dataset.orsak;
      $('oOrsaker').querySelectorAll('.chip').forEach((x) => x.classList.toggle('vald', x === k));
      visa();
    };
  });
  visa();

  $('oAvbryt').onclick = () => stangPanel('modal');
  $('oSpara').onclick = async () => {
    if (val.genomford === null) { $('oFel').textContent = 'Svara om bokningen genomfördes.'; return; }
    if (val.genomford === false && !val.orsak) { $('oFel').textContent = 'Välj varför den inte blev av.'; return; }
    const knapp = $('oSpara');
    if (knapp.disabled) return;
    knapp.disabled = true;
    knapp.textContent = 'Sparar…';
    try {
      await anrop('aterkoppling-spara', {
        bokning_id: id,
        genomford: val.genomford,
        orsak: val.genomford ? undefined : val.orsak,
        vad_hande: val.genomford ? $('oVad').value.trim() : undefined,
        intresserad: val.genomford && val.intresserad !== null ? val.intresserad : undefined,
        blev_jobb: val.genomford && val.blev_jobb !== null ? val.blev_jobb : undefined,
        belopp: val.genomford && val.blev_jobb && $('oBelopp').value ? $('oBelopp').value : undefined,
        text: $('oText').value.trim(),
      });
    } catch (e) {
      knapp.disabled = false;
      knapp.textContent = 'Spara omdöme';
      $('oFel').textContent = e.message;
      return;
    }
    // Sparat. Det som följer får inte se ut som att sparandet misslyckades —
    // då skulle samma omdöme skickas en gång till.
    toast('Omdömet är sparat ✓');
    dataAndrad();
    await rita().catch(() => {});
    // Kunden bokade om: direkt vidare till en ny tid på samma bokning.
    const flytta = val.genomford === false && val.orsak === 'ombokad' && b.far_andra;
    if (flytta) {
      redigeraBokning(bokningar.find((x) => x.id === id) || b, { klar: () => { stangPanel('modal'); rita(); } });
    } else {
      stangPanel('modal');
    }
  };
  if ($('oFlytta')) $('oFlytta').onclick = () => $('oSpara').click();
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
