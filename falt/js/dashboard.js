/** Sales Dashboard — hela säljkårens prestation i realtid. */

import { anrop } from './api.js';
import { $, esc, toast, idag, plusDagar, veckostart, visaDatum, procent, oppnaPanel } from './ui.js';
import { S, arRoll } from './state.js';

let sortering = 'bokade';
let senasteData = null;
let jamforVal = [];

const KOLUMNER = [
  { nyckel: 'bokade', text: 'Bokade' },
  { nyckel: 'hitrate', text: 'Hit rate' },
  { nyckel: 'dorrar', text: 'Dörrar' },
  { nyckel: 'genomforda', text: 'Genomförda' },
  { nyckel: 'aterkom', text: 'Återkom' },
  { nyckel: 'nej', text: 'Nej' },
  { nyckel: 'ejsvar', text: 'Inget svar' },
];

/** Översätter periodvalet till ett datumintervall. */
export function period() {
  const val = $('dPeriod').value;
  const nu = idag();
  const mstart = nu.slice(0, 8) + '01';
  switch (val) {
    case 'idag': return { fran: nu, till: nu };
    case 'igar': return { fran: plusDagar(-1), till: plusDagar(-1) };
    case 'vecka': return { fran: veckostart(), till: nu };
    case 'forravecka': return { fran: plusDagar(-7, veckostart()), till: plusDagar(-1, veckostart()) };
    case 'manad': return { fran: mstart, till: nu };
    case 'forramanad': {
      const d = new Date(mstart + 'T12:00:00');
      d.setMonth(d.getMonth() - 1);
      const f = d.toISOString().slice(0, 8) + '01';
      return { fran: f, till: plusDagar(-1, mstart) };
    }
    case 'allt': return { fran: '2000-01-01', till: nu };
    default: return { fran: $('dFran').value || nu, till: $('dTill').value || nu };
  }
}

/**
 * Hur många dagar målet ska räknas för. Dagsmålet gånger en vecka är
 * veckans mål — annars såg en hel månad ut som 2 % av "dagens mål".
 */
function malDagar(p) {
  if ($('dPeriod').value === 'allt') return 0;   // meningslöst att jämföra
  const fran = new Date(p.fran + 'T12:00:00');
  const till = new Date((p.till < idag() ? p.till : idag()) + 'T12:00:00');
  const dagar = Math.round((till - fran) / 86400000) + 1;
  return Math.max(1, Math.min(dagar, 366));
}

function kpiKort(kpi, mal, aktiva, dagar) {
  const malKort = (varde, malVarde, etikett, suffix = '') => {
    if (!malVarde) return '';
    const p = procent(varde, malVarde);
    const klass = p >= 100 ? 'mal-gron' : p >= 75 ? 'mal-gul' : 'mal-rod';
    return '<div class="mal ' + klass + '">' + (p >= 100 ? '🟢' : p >= 75 ? '🟡' : '🔴') +
      ' ' + p + '% av ' + etikett + ' (' + malVarde + suffix + ')</div>';
  };

  // Lagmålet är säljarnas individuella mål gånger antalet som varit ute,
  // gånger antalet dagar perioden omfattar.
  const lag = Math.max(aktiva, 1) * dagar;
  const etikett = dagar > 1 ? 'periodens mål' : 'dagens mål';
  return '<div class="kpi-rutnat">' +
    '<div class="kpi stor"><b>' + kpi.dorrar + '</b><small>Dörrar knackade</small>' +
      malKort(kpi.dorrar, mal.dorrar * lag, etikett) + '</div>' +
    '<div class="kpi gron"><b>' + kpi.bokade + '</b><small>Bokade möten</small>' +
      malKort(kpi.bokade, mal.bokningar * lag, etikett) + '</div>' +
    '<div class="kpi"><b>' + kpi.hitrate + ' %</b><small>Hit rate</small>' +
      malKort(kpi.hitrate, mal.hitrate, 'målet', ' %') + '</div>' +
    '<div class="kpi"><b>' + kpi.aktiva_saljare + '</b><small>Aktiva säljare</small></div>' +
    '<div class="kpi"><b>' + kpi.nej + '</b><small>Nej</small></div>' +
    '<div class="kpi"><b>' + kpi.ejsvar + '</b><small>Inget svar</small></div>' +
    '<div class="kpi"><b>' + kpi.aterkom + '</b><small>Återkom</small></div>' +
    '<div class="kpi"><b>' + kpi.genomforda + '</b><small>Genomförda möten</small></div>' +
    '</div>';
}

function podium(lb, rubrik) {
  const topp = lb.slice(0, 3);
  if (!topp.length) return '';
  const medaljer = ['🥇', '🥈', '🥉'];
  return '<div class="sektion"><h3>' + esc(rubrik) + '</h3><div class="podium">' +
    topp.map((s, i) => '<div><div class="medalj">' + medaljer[i] + '</div>' +
      '<div class="pnamn">' + esc(s.namn) + '</div>' +
      '<div class="pvarde">' + s.bokade + ' bokningar</div></div>').join('') +
    '</div></div>';
}

function leaderboard(lb, mal) {
  if (!lb.length) return '<div class="sektion"><div class="tom">Inga registrerade dörrar i perioden.</div></div>';

  const sorterad = lb.slice().sort((a, b) => (b[sortering] || 0) - (a[sortering] || 0));
  const medaljer = ['🥇', '🥈', '🥉'];

  return '<div class="sektion"><h3>Sales leaderboard</h3>' +
    '<div class="chips" style="margin-bottom:10px">' +
    KOLUMNER.map((k) => '<button class="chip' + (k.nyckel === sortering ? ' vald' : '') +
      '" data-sort="' + k.nyckel + '">' + esc(k.text) + '</button>').join('') +
    '</div>' +
    '<div class="panelkort rullbar"><table class="tabell"><thead><tr>' +
    '<th></th><th>Säljare</th><th>Dörrar</th><th>Bokade</th><th>Hit rate</th>' +
    '<th>Nej</th><th>Inget svar</th><th>Återkom</th><th>Genomf.</th>' +
    (mal.dorrar ? '<th>Mål</th>' : '') +
    '</tr></thead><tbody>' +
    sorterad.map((s, i) => {
      const malP = mal.dorrar ? procent(s.dorrar, mal.dorrar) : 0;
      const klass = malP >= 100 ? 'mal-gron' : malP >= 75 ? 'mal-gul' : 'mal-rod';
      return '<tr class="' + (s.id === S.anvandare.id ? 'jag' : '') + '" data-saljare="' + esc(s.id) + '">' +
        '<td class="plats">' + (medaljer[i] || (i + 1)) + '</td>' +
        '<td class="namn">' + esc(s.namn) + '</td>' +
        '<td>' + s.dorrar + '</td><td><b>' + s.bokade + '</b></td>' +
        '<td>' + s.hitrate + ' %</td>' +
        '<td>' + s.nej + '</td><td>' + s.ejsvar + '</td><td>' + s.aterkom + '</td>' +
        '<td>' + s.genomforda + '</td>' +
        (mal.dorrar ? '<td class="' + klass + '">' + malP + ' %</td>' : '') +
        '</tr>';
    }).join('') +
    '</tbody></table></div>' +
    '<button class="chip" id="jamforKnapp" style="margin-top:10px">Jämför säljare</button></div>';
}

function funnel(f) {
  const steg = [
    ['Dörrar', f.dorrar], ['Öppnade', f.oppnade], ['Positiva samtal', f.positiva],
    ['Bokade', f.bokade], ['Genomförda', f.genomforda],
  ];
  const max = Math.max(...steg.map((s) => s[1]), 1);
  return '<div class="sektion"><h3>Sales funnel</h3><div class="panelkort trappa">' +
    steg.map(([namn, varde], i) => {
      const bredd = Math.max(12, Math.round((varde / max) * 100));
      const foreg = i ? steg[i - 1][1] : 0;
      return '<div class="trappsteg">' +
        '<div class="stapel" style="width:' + bredd + '%">' + varde + '</div>' +
        '<div class="etikett">' + esc(namn) + (i ? ' · ' + procent(varde, foreg) + ' %' : '') + '</div>' +
        '</div>';
    }).join('') + '</div></div>';
}

function omraden(lista) {
  if (!lista.length) return '';
  return '<div class="sektion"><h3>Resultat per område</h3><div class="panelkort rullbar">' +
    '<table class="tabell"><thead><tr><th>Område</th><th>Dörrar</th><th>Bokade</th><th>Hit rate</th><th>Nej</th></tr></thead><tbody>' +
    lista.map((o) => '<tr><td class="namn">' + esc(o.namn) + '</td><td>' + o.dorrar + '</td>' +
      '<td><b>' + o.bokade + '</b></td><td>' + o.hitrate + ' %</td><td>' + o.nej + '</td></tr>').join('') +
    '</tbody></table></div></div>';
}

function utmarkelser(lb, forra) {
  if (!lb.length) return '';
  const basta = (nyckel) => lb.slice().sort((a, b) => b[nyckel] - a[nyckel])[0];
  const bokning = basta('bokade'), hit = basta('hitrate'), dorr = basta('dorrar');

  let forbattrad = null;
  if (forra && forra.length) {
    const karta = {};
    forra.forEach((f) => { karta[f.id] = f; });
    lb.forEach((s) => {
      const f = karta[s.id];
      if (!f || !f.hitrate) return;
      const diff = Math.round((s.hitrate - f.hitrate) * 10) / 10;
      if (!forbattrad || diff > forbattrad.diff) forbattrad = { namn: s.namn, diff };
    });
  }

  return '<div class="sektion"><h3>Utmärkelser</h3><div class="panelkort">' +
    '<div class="trappsteg" style="margin-bottom:8px">🏆 <span class="etikett">Flest bokningar: <b>' +
      esc(bokning.namn) + '</b> — ' + bokning.bokade + '</span></div>' +
    '<div class="trappsteg" style="margin-bottom:8px">🎯 <span class="etikett">Bäst hit rate: <b>' +
      esc(hit.namn) + '</b> — ' + hit.hitrate + ' %</span></div>' +
    '<div class="trappsteg"' + (forbattrad ? ' style="margin-bottom:8px"' : '') + '>🚪 <span class="etikett">Flest dörrar: <b>' +
      esc(dorr.namn) + '</b> — ' + dorr.dorrar + '</span></div>' +
    (forbattrad && forbattrad.diff > 0
      ? '<div class="trappsteg">📈 <span class="etikett">Störst förbättring: <b>' + esc(forbattrad.namn) +
        '</b> — ' + (forbattrad.diff > 0 ? '+' : '') + forbattrad.diff + ' procentenheter mot förra veckan</span></div>'
      : '') +
    '</div></div>';
}

/* ── Enskild säljare ── */

async function visaSaljare(id) {
  const s = (senasteData.leaderboard || []).find((x) => x.id === id);
  if (!s) return;

  const f = { dorrar: s.dorrar, oppnade: s.oppnade, positiva: s.positiva, bokade: s.bokade, genomforda: s.genomforda };
  const mal = senasteData.mal;
  const malRad = (varde, malVarde, text) => {
    if (!malVarde) return '';
    const p = procent(varde, malVarde);
    return '<div class="trappsteg"><span class="etikett">' + (p >= 100 ? '🟢' : p >= 75 ? '🟡' : '🔴') +
      ' ' + esc(text) + ': ' + varde + ' / ' + malVarde + ' → <b>' + p + ' %</b></span></div>';
  };

  const panel = oppnaPanel('modal',
    '<h2>' + esc(s.namn) + '</h2>' +
    '<p class="sub">' + esc(visaDatum(senasteData.period.fran)) +
    (senasteData.period.fran !== senasteData.period.till ? ' – ' + esc(visaDatum(senasteData.period.till)) : '') + '</p>' +
    '<div class="kpi-rutnat" style="padding:14px 0 0">' +
    '<div class="kpi stor"><b>' + s.dorrar + '</b><small>Dörrar</small></div>' +
    '<div class="kpi gron"><b>' + s.bokade + '</b><small>Bokade</small></div>' +
    '<div class="kpi"><b>' + s.hitrate + ' %</b><small>Hit rate</small></div>' +
    '<div class="kpi"><b>' + s.genomforda + '</b><small>Genomförda</small></div>' +
    '</div>' +
    (mal.dorrar ? '<h3>Måluppföljning</h3><div class="panelkort">' +
      malRad(s.dorrar, mal.dorrar, 'Dörrar') +
      malRad(s.bokade, mal.bokningar, 'Bokningar') +
      malRad(s.hitrate, mal.hitrate, 'Hit rate') + '</div>' : '') +
    funnel(f).replace('<div class="sektion">', '<div>').replace(/<\/div>$/, '</div>') +
    '<h3>Utveckling per vecka</h3><div class="panelkort" id="trend">Hämtar…</div>' +
    '<div class="btn-rad"><button class="btn btn-primary" id="stangSaljare">Stäng</button></div>');

  $('stangSaljare').onclick = () => document.getElementById('modalOverlay').classList.remove('open');

  try {
    const t = await anrop('saljare-trend', { id, veckor: 6 });
    const rader = t.trend || [];
    $('trend').innerHTML = rader.length
      ? rader.map((r) => '<div class="trappsteg"><span class="etikett">Vecka ' + esc(r.vecka.split('-')[1]) +
          ': ' + r.dorrar + ' dörrar, ' + r.bokade + ' bokade → <b>' + r.hitrate + ' %</b></span></div>').join('')
      : '<div class="etikett">Ingen historik än.</div>';
  } catch (e) {
    $('trend').textContent = 'Kunde inte hämta trenden.';
  }
}

function visaJamforelse() {
  const lb = senasteData.leaderboard || [];
  const valda = lb.filter((s) => jamforVal.includes(s.id));
  const rader = [
    ['Dörrar', 'dorrar'], ['Öppnade', 'oppnade'], ['Positiva', 'positiva'],
    ['Bokade', 'bokade'], ['Hit rate', 'hitrate'], ['Nej', 'nej'],
    ['Inget svar', 'ejsvar'], ['Återkom', 'aterkom'], ['Genomförda', 'genomforda'],
  ];

  oppnaPanel('modal',
    '<h2>Jämför säljare</h2><p class="sub">Välj två eller fler.</p>' +
    '<div class="chips" style="margin:12px 0">' +
    lb.map((s) => '<button class="chip' + (jamforVal.includes(s.id) ? ' vald' : '') +
      '" data-j="' + esc(s.id) + '">' + esc(s.namn) + '</button>').join('') + '</div>' +
    (valda.length >= 2
      ? '<div class="panelkort rullbar"><table class="tabell"><thead><tr><th>KPI</th>' +
        valda.map((s) => '<th>' + esc(s.namn) + '</th>').join('') + '</tr></thead><tbody>' +
        rader.map(([text, nyckel]) => {
          const max = Math.max(...valda.map((s) => s[nyckel] || 0));
          return '<tr><td class="namn">' + esc(text) + '</td>' +
            valda.map((s) => '<td' + ((s[nyckel] || 0) === max && max > 0 ? ' style="color:var(--gold);font-weight:700"' : '') +
              '>' + (s[nyckel] || 0) + (nyckel === 'hitrate' ? ' %' : '') + '</td>').join('') + '</tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="tom">Välj minst två säljare.</div>') +
    '<div class="btn-rad"><button class="btn btn-primary" id="stangJamfor">Stäng</button></div>');

  document.querySelectorAll('[data-j]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.j;
      jamforVal = jamforVal.includes(id) ? jamforVal.filter((x) => x !== id) : jamforVal.concat(id);
      visaJamforelse();
    };
  });
  $('stangJamfor').onclick = () => document.getElementById('modalOverlay').classList.remove('open');
}

/* ── Huvudrendering ── */

export async function rita() {
  const behallare = $('dashInnehall');
  if (!senasteData) behallare.innerHTML = '<div class="tom">Hämtar siffror…</div>';

  const p = period();
  let data, forra = null;
  try {
    data = await anrop('dashboard', { ...p, omrade_id: $('dOmrade').value || undefined });
    if ($('dPeriod').value === 'vecka') {
      const f = await anrop('dashboard', {
        fran: plusDagar(-7, veckostart()), till: plusDagar(-1, veckostart()),
        omrade_id: $('dOmrade').value || undefined,
      });
      forra = f.leaderboard;
    }
  } catch (e) {
    behallare.innerHTML = '<div class="tom">Kunde inte hämta statistiken: ' + esc(e.message) + '</div>';
    return;
  }

  senasteData = data;
  const dagar = malDagar(p);
  $('vySub').textContent = visaDatum(data.period.fran) +
    (data.period.fran !== data.period.till ? ' – ' + visaDatum(data.period.till) : '') +
    ' · hit rate på ' + (data.namnare === 'oppnade' ? 'öppnade dörrar' : data.namnare === 'positiva' ? 'positiva samtal' : 'alla dörrar');

  behallare.innerHTML =
    kpiKort(data.kpi, data.mal, data.kpi.aktiva_saljare, dagar) +
    podium(data.leaderboard, dagar > 1 ? 'Bäst i perioden' : 'Dagens topp') +
    leaderboard(data.leaderboard, data.mal) +
    '<div class="sektion tva" style="padding:0">' + funnel(data.funnel) + omraden(data.omraden) + '</div>' +
    utmarkelser(data.leaderboard, forra);

  behallare.querySelectorAll('[data-sort]').forEach((b) => {
    b.onclick = () => { sortering = b.dataset.sort; rita(); };
  });
  behallare.querySelectorAll('[data-saljare]').forEach((tr) => {
    tr.onclick = () => visaSaljare(tr.dataset.saljare);
  });
  const jamfor = $('jamforKnapp');
  if (jamfor) jamfor.onclick = visaJamforelse;
}

export function koppla() {
  $('dPeriod').addEventListener('change', () => {
    $('dEgetRad').hidden = $('dPeriod').value !== 'eget';
    if ($('dPeriod').value !== 'eget') rita();
  });
  ['dFran', 'dTill', 'dOmrade'].forEach((id) => $(id).addEventListener('change', rita));
  $('dFran').value = idag();
  $('dTill').value = idag();
}
