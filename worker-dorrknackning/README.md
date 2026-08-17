# Delad dörrknackningslista — server

Backend till appen på [autoads.se/dorrknackning/](https://autoads.se/dorrknackning/).
Utan den här servern sparar appen bara lokalt i varje telefon. Med den ser hela
säljteamet samma bokningar, och du kommer åt listan från datorn.

Cloudflare Worker + D1 (SQLite). Ryms med god marginal i Cloudflares gratisnivå
för den här mängden data.

## Sätt upp den — sju kommandon

Kör allt i den här mappen (`worker-dorrknackning/`). Du behöver Node installerat
och ett Cloudflare-konto (samma som SMS-workern använder).

```bash
# 1. Logga in mot Cloudflare (öppnar webbläsaren)
npx wrangler login

# 2. Skapa databasen
npx wrangler d1 create autoads-dorrknackning
```

Kommandot skriver ut ett `database_id`. Klistra in det i `wrangler.toml` där det
står `FYLL_I_DATABASE_ID_HAR`.

```bash
# 3. Skapa tabellen i databasen
npx wrangler d1 execute autoads-dorrknackning --remote --file=./schema.sql

# 4. Hitta på en lång teamnyckel (fungerar som lösenord för hela teamet)
openssl rand -base64 24

# 5. Lägg in nyckeln som hemlighet — klistra in värdet från steg 4
npx wrangler secret put TEAM_KEY

# 6. Publicera
npx wrangler deploy
```

Deploy skriver ut en adress, ungefär
`https://autoads-dorrknackning.<ditt-konto>.workers.dev`.

**7.** Öppna appen i mobilen → menyn (☰) → **Delad lista** → fyll i adressen från
steg 6, teamnyckeln från steg 4 och ditt namn → **Spara & synka**. Samma två
uppgifter läggs in i varje säljares telefon. Statusprickan uppe till vänster blir
grön och visar *Delad*.

## Så fungerar synken

Appen anropar `POST /sync` med de ändringar telefonen gjort sedan förra gången,
och får tillbaka allt som andra ändrat. Det sker vid start, ~1 sekund efter varje
registrering, varje minut när appen är öppen och så fort telefonen får nät igen.

- **Offline:** allt sparas lokalt först. Utan täckning visar statusprickan gult
  *"3 väntar"* och skickas upp automatiskt när nätet är tillbaka.
- **Två som ändrat samma adress:** den senaste ändringen vinner. Besöksräknaren
  tar alltid det högsta värdet, så ingen knackning tappas bort.
- **Raderingar** sparas som markering, inte som en borttagen rad, så att de når
  övriga telefoner. De städas bort ur databasen efter 90 dagar.
- **Klockor:** vilken version som vinner avgörs av telefonens klocka, men vad en
  telefon redan hämtat avgörs av serverns klocka. En telefon med fel tid gör
  därför inte att poster missas.

## Säkerhet

Teamnyckeln är hela skyddet — den som har den kommer åt listan. Behandla den som
ett lösenord: skicka den inte i grupp-SMS och lägg inte in den i repot.

Byta nyckel (t.ex. när någon slutar):

```bash
npx wrangler secret put TEAM_KEY   # ny nyckel
npx wrangler deploy
```

Därefter måste varje telefon lägga in den nya nyckeln under **Delad lista**.
Data ligger kvar orörd i databasen.

Servern tar bara emot anrop från `autoads.se`. Eftersom kunduppgifter nu ligger
på en server och inte bara i telefonen: registrera inte mer än vad bokningen
kräver, och rensa poster som inte behövs längre.

## API

| Anrop | Beskrivning |
|---|---|
| `GET /halsa` | Svarar `{"ok":true}` om workern lever. Kräver ingen nyckel. |
| `POST /sync` | Kräver `Authorization: Bearer <TEAM_KEY>`. Body: `{"since":<ms>,"poster":[…]}`. Svar: `{"ok":true,"nu":<ms>,"poster":[…]}` med allt som ändrats sedan `since`. |

Max 500 poster per anrop och 1000 poster tillbaka per svar; appen delar upp
större mängder automatiskt.

## Titta på datan från datorn

```bash
npx wrangler d1 execute autoads-dorrknackning --remote \
  --command "SELECT datum, tid, adress, namn, telefon, status, saljare FROM poster WHERE borttagen = 0 ORDER BY datum"
```

I appen finns också **Exportera CSV** i menyn, som ger hela listan till Excel.

## Ändra servern

```bash
npx wrangler dev      # kör lokalt
npx wrangler tail     # loggar från den publicerade workern
```
