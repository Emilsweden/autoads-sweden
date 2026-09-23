# 16 — Migreringar och data

**Produktionsdatabasen innehåller riktiga kundbokningar.** Ingen ändring i
schemat får radera eller skriva om dem utan att det uttryckligen beslutats.

## Regler för schemaändringar

- En ny kolumn läggs **både** i `schema.sql` (för nya databaser) **och** i
  workflowens loop i *Uppdatera gamla tabeller* (för den som finns).
- Index på nya kolumner hör hemma i workflowen och i `EFTER_SCHEMAT` i
  `tester/server.mjs` — inte i `schema.sql` (där finns kolumnen inte än på
  en gammal databas när filen körs). Nya tabeller kan ha sina index i schemat.
- Datamigreringar läggs i *Flytta över gamla data*, skrivs så att de kan
  köras flera gånger (`WHERE` som bara träffar det som inte redan flyttats)
  och får inte vara `continue-on-error`.
- Testet *varje ny kolumn i schemat läggs också på gamla databaser* i
  `bokning.test.mjs` larmar om något glöms.

## Migreringar i den här versionen

| Vad | Hur |
|---|---|
| Arbetstid | `arbetstid_fran/till` sätts för besiktare som saknar den, vidgad så att deras kommande tider ryms |
| Återkom | `UPDATE adresser SET status = 'ejsvar' WHERE status = 'aterkom'`; historiken behåller `aterkom` |
| Orter | Tabellerna skapas av schemat, med fem orter; inga besiktare kopplas automatiskt |
| Övriga nya kolumner | Tomma (NULL) på gamla rader, vilket är rätt utgångsläge |

## Säkerhetskopia av datan

Datan följer inte med repot. Exportera den från Cloudflare:

    npx wrangler d1 export autoads-falt --remote --output=backup.sql

och läs in i en ny databas med `wrangler d1 execute <namn> --remote --file=backup.sql`.
Filen innehåller kunddata och ska hanteras därefter — inte läggas i repot.
