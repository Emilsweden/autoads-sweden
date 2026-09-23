# Villa Takrenovering — fältsystemet

Follow the ECC workflow: plan → test → implement → review → verify.

## Arbetsflödet här

1. **Plan** — större ändringar: agenten `planner`. Läs först hur det fungerar i dag.
2. **Test** — skriv eller ändra testet i `tester/` innan koden. Nya regler i
   servern får ett API-test; ändringar i flöden i appen får ett i `appen.test.mjs`.
3. **Implement** — bygg vidare på det som finns. Ingen ny arkitektur.
4. **Review** — agenten `code-reviewer`; allt som rör behörigheter, inloggning
   eller kunddata även `security-reviewer`.
5. **Verify** — `./tester/kor.sh` ska vara grönt. För ändringar i appen: starta
   `node --disable-warning=ExperimentalWarning tester/server.mjs` och titta.

## Repot

- `falt/` — appen. Vanliga ES-moduler, inget byggsteg, en CSS-fil.
- `worker-falt/` — Cloudflare Worker och D1. Hela API:t ligger i `src/index.js`.
- `tester/` — `server.mjs` kör workern, databasen (i minnet) och appen i en
  process. Testerna startar var sin server på en ledig port.
- Utrullning sker bara via Actions → *Sätt upp fältsystemet* (workflow_dispatch).
  Ingenting rullas ut automatiskt.

## Regler som gäller före ECC:s allmänna

- Ändra bara det som efterfrågas. Ta inte bort fungerande funktioner.
- Namn och kommentarer på svenska. Kommentarer förklarar varför, inte vad.
- Commitrubriker är beskrivande meningar — inte `feat:`/`fix:`.
- Behörigheter avgörs i servern, aldrig bara genom att dölja en knapp.
- En ny kolumn läggs både i `schema.sql` och i workflowens steg *Uppdatera
  gamla tabeller*. Index på nya kolumner hör hemma i workflowen, inte i
  `schema.sql` — och i `EFTER_SCHEMAT` i `tester/server.mjs`.
- Produktionsdatabasen innehåller riktiga kundbokningar. Rör dem aldrig utan
  att det uttryckligen efterfrågats.
- Hemligheter (`CLOUDFLARE_API_TOKEN`, `ADMIN_LOSENORD`, `EPOST_NYCKEL` …)
  läggs in av Emil i GitHub — de ska aldrig passera genom en session.
