-- Databas för den delade dörrknackningslistan.
-- Kör:  npx wrangler d1 execute autoads-dorrknackning --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS poster (
  id          TEXT PRIMARY KEY,
  adress      TEXT NOT NULL,
  namn        TEXT,
  telefon     TEXT,
  status      TEXT,
  datum       TEXT,
  tid         TEXT,
  anteckning  TEXT,
  besok       INTEGER DEFAULT 1,
  klar        INTEGER DEFAULT 0,
  borttagen   INTEGER DEFAULT 0,
  saljare     TEXT,
  skapad      INTEGER,
  -- Klockan i telefonen som sparade posten. Används för att avgöra vilken
  -- version som vinner när två säljare ändrat samma adress.
  uppdaterad  INTEGER NOT NULL,
  -- Serverns klocka. Används som markör för vad en telefon redan hämtat,
  -- så att felställda telefonklockor inte gör att poster missas.
  server_tid  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_poster_server_tid ON poster(server_tid);
