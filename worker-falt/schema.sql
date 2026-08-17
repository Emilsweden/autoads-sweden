-- Autoads Fältsystem — databas (Cloudflare D1 / SQLite)
-- Kör:  npx wrangler d1 execute autoads-falt --remote --file=./schema.sql

/* ── Användare och inloggning ── */

CREATE TABLE IF NOT EXISTS anvandare (
  id        TEXT PRIMARY KEY,
  namn      TEXT NOT NULL,
  epost     TEXT NOT NULL UNIQUE,
  roll      TEXT NOT NULL DEFAULT 'saljare',   -- admin | teamleader | saljare
  team      TEXT,
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
  kommentar    TEXT,
  status       TEXT NOT NULL DEFAULT 'bokad',  -- bokad | genomford | avbokad
  skapad       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bok_datum ON bokningar(datum);
CREATE INDEX IF NOT EXISTS idx_bok_anv ON bokningar(anvandare_id);

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
