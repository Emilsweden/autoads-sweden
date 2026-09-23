# 15 — Utrullning

Utrullning sker **bara** från GitHub: Actions → *Sätt upp fältsystemet* →
Run workflow. Ingenting rullas ut automatiskt vid en push.

## Hemligheter (GitHub → Settings → Secrets and variables → Actions)

| Namn | Krävs | Vad |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ja | Token med behörighet för Workers och D1 |
| `ADMIN_LOSENORD` | ja | Lösenord för den första administratören (minst 8 tecken) |
| `CLOUDFLARE_ACCOUNT_ID` | om token når flera konton | |
| `EPOST_NYCKEL`, `EPOST_AVSANDARE` | nej | Mejl till besiktaren vid ny bokning (Resend) |
| `GOOGLE_MAPS_NYCKEL`, `GOOGLE_MAPS_KARTID` | nej | Googles karta; tomma = OpenStreetMap |

Hemligheterna läggs in av ägaren och ska aldrig skrivas i repot eller i en
chatt.

## Stegen i workflowen

1. Kontrollera hemligheter.
2. Installera wrangler.
3. Skapa databasen om den saknas (`autoads-falt`).
4. **Skapa tabellerna** — kör `schema.sql`.
5. **Uppdatera gamla tabeller** — `ALTER TABLE … ADD COLUMN` för varje
   kolumn som tillkommit, plus index på nya kolumner. Får misslyckas tyst
   när kolumnen redan finns.
6. **Skydda mot dubbelbokning** — det unika indexet. Stoppar inte
   utrullningen om gamla krockar finns, utan listar dem.
7. **Flytta över gamla data** — arbetstid för befintliga besiktare som har
   tider utanför 09–18, och Återkom → Inget svar. Kan köras hur många
   gånger som helst.
8. **Möten hos Admin Besiktare** — varnar om kommande möten ligger på
   konton som inte längre går att boka. Rör dem inte.
9. **Publicera workern** (`wrangler deploy`, appen följer med som assets).
10. Koppla e-postutskick (om hemligheterna finns).
11. Skapa den första administratören (bara om ingen finns).
12. Sammanfattning.

Efter en utrullning: öppna appen, logga in, kontrollera versionen på
inloggningsskärmen (`VERSION` i `falt/config.js`).

## Före utrullningen av den här versionen

Om Admin Besiktare-konton har kommande möten (steg 8 varnar), flytta dem
till en besiktare under Bokningar → Redigera bokning. Om Admin Besiktare
själv åker ut på besiktningar behöver han ett eget besiktarkonto.
