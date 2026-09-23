# 02 — Arkitektur

    Telefonen (PWA, falt/)  ──POST /api/<namn>──▶  Cloudflare Worker (worker-falt/src/index.js)
          │  service worker, kö utan nät                    │
          │                                                 ▼
          └──── samma adress serverar appen ◀──  [assets] falt/     Cloudflare D1 (SQLite)

## Delarna

| Del | Var | Vad |
|---|---|---|
| Appen | `falt/` | Vanliga ES-moduler, inget byggsteg, en CSS-fil (`app.css`). `index.html` laddar `js/app.js`. |
| Service worker | `falt/sw.js` | Cachar appens skal (`SKAL`) så att den startar utan nät. `CACHE` höjs vid varje ändring i `falt/`. |
| Kartan | `falt/js/kartmotor.js`, `karta.js`, `falt/maplibre/`, `falt/kartstil/liberty.json` | MapLibre med OpenFreeMaps stil Liberty, som ligger i appen. |
| Servern | `worker-falt/src/index.js` | Hela API:t i en fil. Router längst ned. |
| Databasen | Cloudflare D1, schema i `worker-falt/schema.sql` | Se [04_DATAMODELL.md](04_DATAMODELL.md). |
| Utrullning | `.github/workflows/satt-upp-faltsystemet.yml` | Körs för hand (workflow_dispatch). Se [15_UTRULLNING.md](15_UTRULLNING.md). |
| Tester | `tester/` | `server.mjs` kör workern mot SQLite i minnet. Se [14_TESTER.md](14_TESTER.md). |

## Appens moduler (`falt/js/`)

| Fil | Ansvar |
|---|---|
| `app.js` | Start, inloggning, navigering, bokningsflikar, pulsen |
| `api.js` | `anrop()`, kön utan nät (`laggIKo`, `tommeKo`) |
| `state.js` | Gemensamt läge `S`, `kan(förmåga)`, händelsebuss |
| `ui.js` | Paneler, toast, datum, färger och etiketter |
| `karta.js`, `kartmotor.js`, `geo.js` | Kartan, dörrarna, adressuppslag mot OpenStreetMap |
| `dorr.js` | Dörrpanelen: utfall, bokningsflödet, tiden först, radera dörr |
| `redigera.js` | Redigera bokning — samma formulär överallt |
| `kalender.js` | Bokningskalendern (bara bokningsbara tider) |
| `tider.js` | Besiktarnas scheman som månadskalender |
| `bokade.js` | Bokade adresser / Mina möten, omdöme, kommentarer, bilder |
| `listor.js` | Kommande, Månadslista, Skapade |
| `flode.js` | Nyheter |
| `dashboard.js` | Översikt och statistik |
| `admin.js` | Användare, orter, områden, regler |
| `anteckningar.js` | Import av inklistrade anteckningar (inte länkad från appen längre) |

## Anropen

Alla anrop är `POST /api/<namn>` med JSON. Inloggningen ger en token som
skickas som `Authorization: Bearer <token>` eller i kroppen. Servern svarar
`{ ok: true, ... }` eller `{ ok: false, fel: "..." }` med rätt statuskod
(400 fel indata, 401 utloggad, 403 behörighet, 404 finns inte, 409 krock).

Routern slår upp namnet i tabellen `api`, kontrollerar sessionen (utom
`logga-in`, `logga-ut`, `installera`) och stämplar efter varje lyckat
ändrande anrop tabellen `andringar`, som pulsen läser.

## Principer

- **Behörigheter avgörs i servern.** En dold knapp är ingen behörighet.
  Appen visar knappar efter flaggor servern skickar (`far_andra`,
  `far_radera` …) och servern kontrollerar samma sak igen.
- **Reglerna sitter i skrivningen.** En bokning sparas med reglerna i sitt
  `WHERE`, inuti en D1-batch (transaktion).
- **Servern räknar, telefonen visar.** Lediga tider räknas ut i servern.
