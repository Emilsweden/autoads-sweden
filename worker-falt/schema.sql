-- Autoads Fältsystem — databas (Cloudflare D1 / SQLite)
-- Kör:  npx wrangler d1 execute autoads-falt --remote --file=./schema.sql

/* ── Användare och inloggning ── */

CREATE TABLE IF NOT EXISTS anvandare (
  id        TEXT PRIMARY KEY,
  namn      TEXT NOT NULL,
  epost     TEXT NOT NULL UNIQUE,
  -- admin | teamleader | bokare_plus (Mötesbokare+) | saljadmin (Admin Säljare)
  -- | saljare (Mötesbokare) | besiktare (Säljare/Takbesiktare)
  roll      TEXT NOT NULL DEFAULT 'saljare',
  team      TEXT,
  max_per_dag INTEGER NOT NULL DEFAULT 3,   -- besiktarens tak för bokningar per dag
  snabbtider  TEXT,                         -- egen mall, t.ex. "10:00,13:00,17:00"
  hash      TEXT NOT NULL,
  salt      TEXT NOT NULL,
  aktiv     INTEGER NOT NULL DEFAULT 1,
  skapad    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessioner (
  token        TEXT PRIMARY KEY,
  anvandare_id TEXT NOT NULL,
  giltig_till  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sess_anv ON sessioner(anvandare_id);

/* ── Områden ── */

CREATE TABLE IF NOT EXISTS omraden (
  id     TEXT PRIMARY KEY,
  namn   TEXT NOT NULL,
  ort    TEXT,
  skapad INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS omrade_saljare (
  omrade_id    TEXT NOT NULL,
  anvandare_id TEXT NOT NULL,
  PRIMARY KEY (omrade_id, anvandare_id)
);

/* ── Adresser ──
   nyckel är den normaliserade adressen (gata|nummer|postort) och är unik,
   så att "Västeråsvägen 1" aldrig kan bli två olika rader.
   Status och senaste besök ligger denormaliserat här för att kartan ska
   kunna ritas med en enda fråga.                                        */

CREATE TABLE IF NOT EXISTS adresser (
  id              TEXT PRIMARY KEY,
  omrade_id       TEXT NOT NULL,
  gata            TEXT NOT NULL,
  nummer          TEXT NOT NULL,
  postnummer      TEXT,                              -- fem siffror, utan mellanslag
  postort         TEXT,
  nyckel          TEXT NOT NULL UNIQUE,
  lat             REAL,
  lon             REAL,
  status          TEXT NOT NULL DEFAULT 'ejbesokt',  -- ejbesokt|bokat|ejsvar|aterkom|nej
  senast_tid      INTEGER,
  senast_av       TEXT,
  senast_resultat TEXT,
  sparrad_till    INTEGER NOT NULL DEFAULT 0,        -- ms; dörren är fredad till dess
  aterkom_datum   TEXT,
  aterkom_tid     TEXT,
  antal_besok     INTEGER NOT NULL DEFAULT 0,
  broschyr        INTEGER NOT NULL DEFAULT 0,   -- broschyr lämnad i brevlådan
  broschyr_av     TEXT,
  broschyr_tid    INTEGER,
  skapad          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adr_omrade ON adresser(omrade_id);
CREATE INDEX IF NOT EXISTS idx_adr_status ON adresser(status);
CREATE INDEX IF NOT EXISTS idx_adr_aterkom ON adresser(aterkom_datum);

/* ── Dörrhändelser — hela historiken, raderas aldrig ── */

CREATE TABLE IF NOT EXISTS handelser (
  id            TEXT PRIMARY KEY,
  adress_id     TEXT NOT NULL,
  anvandare_id  TEXT NOT NULL,
  resultat      TEXT NOT NULL,              -- bokat | ejsvar | nej | aterkom
  orsak         TEXT,                       -- anledning vid NEJ
  oppnade       INTEGER NOT NULL DEFAULT 0, -- någon öppnade dörren
  positiv       INTEGER NOT NULL DEFAULT 0, -- positivt samtal
  aterkom_datum TEXT,
  aterkom_tid   TEXT,
  kommentar     TEXT,
  lat           REAL,
  lon           REAL,
  skapad        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_h_adress ON handelser(adress_id);
CREATE INDEX IF NOT EXISTS idx_h_anv_tid ON handelser(anvandare_id, skapad);
CREATE INDEX IF NOT EXISTS idx_h_tid ON handelser(skapad);

/* ── Bokningar ── */

CREATE TABLE IF NOT EXISTS bokningar (
  id           TEXT PRIMARY KEY,
  adress_id    TEXT NOT NULL,
  handelse_id  TEXT,
  anvandare_id TEXT NOT NULL,
  fornamn      TEXT,
  efternamn    TEXT,
  telefon      TEXT,
  datum        TEXT,
  tid          TEXT,
  saljare_id   TEXT,                           -- besiktaren mötet är bokat på
  stege        INTEGER NOT NULL DEFAULT 0,     -- ta med stege
  kommentar    TEXT,
  status       TEXT NOT NULL DEFAULT 'bokad',  -- bokad | genomford | avbokad
  skapad       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bok_datum ON bokningar(datum);
CREATE INDEX IF NOT EXISTS idx_bok_anv ON bokningar(anvandare_id);

/* Indexen på saljare_id skapas i uppsättningen, inte här.
   På en databas som redan finns gör CREATE TABLE IF NOT EXISTS ingenting, så
   kolumnen saknas fortfarande när den här filen körs — ett index på den
   avbryter hela filen med "no such column". Uppsättningen lägger till
   kolumnen först och indexen efteråt:

     idx_bok_saljare      (saljare_id, datum)
     idx_bok_saljarslot   unikt på (datum, tid, saljare_id) — skyddet mot
                          dubbelbokning, per säljare. Två säljare kan ha var
                          sitt möte samma timme; samma säljare kan inte.
                          Gamla bokningar utan säljare står utanför indexet. */

/* ── Säljarnas tider ──
   Regeln: har en säljare ingen rad alls för ett datum är hela standarddagen
   (08–20, mån–fre) ledig. Finns rader för datumet gäller bara de med
   ledig = 1. Så en säljare som inte rört sin kalender är ledig som förut,
   och den som lägger in sina tider får exakt de tiderna.                  */

CREATE TABLE IF NOT EXISTS saljartider (
  id         TEXT PRIMARY KEY,
  saljare_id TEXT NOT NULL,
  datum      TEXT NOT NULL,
  tid        TEXT NOT NULL,
  ledig      INTEGER NOT NULL DEFAULT 1,
  satt_av    TEXT,
  skapad     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tid_saljare ON saljartider(saljare_id, datum, tid);
CREATE INDEX IF NOT EXISTS idx_tid_datum ON saljartider(datum);

/* ── Återkoppling på ett genomfört möte ──
   Hör till en bokning. Säljaren skriver den, mötesbokaren som bokade får se
   den på sin bokning, och Mötesbokare+ / Admin Säljare ser alla.          */

CREATE TABLE IF NOT EXISTS aterkoppling (
  id           TEXT PRIMARY KEY,
  bokning_id   TEXT NOT NULL,
  anvandare_id TEXT NOT NULL,
  utfall       TEXT NOT NULL,        -- salt | ej_salt | uppfoljning | uteblev
  belopp       INTEGER,
  text         TEXT,
  skapad       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ater_bok ON aterkoppling(bokning_id, skapad);
CREATE INDEX IF NOT EXISTS idx_ater_tid ON aterkoppling(skapad);

/* ── Nyhetsflöde ──
   En rad per sak som hänt. anvandare_id är den som gjorde det, saljare_id
   den säljare det rör — de två avgör vem som får se raden.                */

CREATE TABLE IF NOT EXISTS nyheter (
  id           TEXT PRIMARY KEY,
  typ          TEXT NOT NULL,        -- bokning | andring | avbokning | aterkoppling | tid | konto
  text         TEXT NOT NULL,
  bokning_id   TEXT,
  saljare_id   TEXT,
  anvandare_id TEXT,
  skapad       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nyhet_tid ON nyheter(skapad);

/* En bortsvepad nyhet försvinner bara för den som svepte. Nyheten står kvar
   för alla andra — därför en rad per användare och nyhet, inte en radering. */
CREATE TABLE IF NOT EXISTS nyhet_dold (
  anvandare_id TEXT NOT NULL,
  nyhet_id     TEXT NOT NULL,
  skapad       INTEGER NOT NULL,
  PRIMARY KEY (anvandare_id, nyhet_id)
);

/* ── Kommentarer och bilder på en bokning ── */

/* Alla inloggade ser och skriver kommentarer på alla bokningar: säljaren som
   bokade, teamledaren och besiktaren som ska ut till kunden. */
CREATE TABLE IF NOT EXISTS kommentarer (
  id           TEXT PRIMARY KEY,
  bokning_id   TEXT NOT NULL,
  anvandare_id TEXT NOT NULL,
  text         TEXT NOT NULL,
  skapad       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_komm_bok ON kommentarer(bokning_id, skapad);

/* Bilder från telefonens bildbibliotek. De skalas ner i appen innan de
   skickas, så en rad rymmer en bild. */
CREATE TABLE IF NOT EXISTS bilagor (
  id           TEXT PRIMARY KEY,
  bokning_id   TEXT NOT NULL,
  anvandare_id TEXT NOT NULL,
  namn         TEXT,
  typ          TEXT,
  storlek      INTEGER,
  data         TEXT NOT NULL,      -- data-URL, nedskalad i appen
  skapad       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bilaga_bok ON bilagor(bokning_id, skapad);

/* ── Säljarnas position ── */

CREATE TABLE IF NOT EXISTS positioner (
  anvandare_id TEXT PRIMARY KEY,
  lat          REAL,
  lon          REAL,
  uppdaterad   INTEGER NOT NULL
);

/* ── Inställningar (spärregler, mål, hit rate-definition) ── */

CREATE TABLE IF NOT EXISTS installningar (
  nyckel TEXT PRIMARY KEY,
  varde  TEXT NOT NULL
);

INSERT OR IGNORE INTO installningar (nyckel, varde) VALUES
  ('sparr_nej', '180'),        -- dagar en dörr är fredad efter NEJ
  ('sparr_ejsvar', '1'),
  ('sparr_bokat', '365'),
  ('sparr_aterkom', '0'),      -- 0 = spärras fram till valt återkomstdatum
  ('nyligen_dagar', '3'),      -- varna om dörren besökts inom så här många dagar
  ('hitrate_namnare', 'alla'), -- alla | oppnade | positiva
  ('mal_dorrar', '100'),
  ('mal_bokningar', '20'),
  ('mal_hitrate', '15');
