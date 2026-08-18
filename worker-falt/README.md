# Fältsystemet — server

Backend till [autoads.se/falt/](https://autoads.se/falt/): användare och roller,
områden, adressdatabas, dörrhistorik, bokningar, spärregler och statistik.

Cloudflare Worker + D1 (SQLite). Ryms i Cloudflares gratisnivå för ett säljteam
av den här storleken.

## Sätt upp

Tre vägar, välj en. Alla ger samma resultat och går att köra om.

### A. Via GitHub — inget behöver köras lokalt

1. Skapa en API-token i Cloudflare: **My Profile → API Tokens → Create Token**,
   mallen *Edit Cloudflare Workers*, och lägg till behörigheten **D1 → Edit**.
2. Lägg in två hemligheter i repot under
   **Settings → Secrets and variables → Actions**:
   - `CLOUDFLARE_API_TOKEN` — token från steg 1
   - `ADMIN_LOSENORD` — lösenordet du vill logga in med (minst 8 tecken)
   - valfritt `CLOUDFLARE_ACCOUNT_ID` om token når flera konton
3. Gå till **Actions → Sätt upp fältsystemet → Run workflow**, fyll i namn och
   e-post och kör.

Sammanfattningen från körningen visar serveradressen du ska klistra in i appen.

### B. Ett kommando lokalt

```bash
npx wrangler login
cd worker-falt && ./satt-upp.sh "Emil" emil@autoads.se
```

Skriptet skapar databasen, fyller i `database_id`, lägger upp tabellerna,
publicerar, sätter installationsnyckeln och skapar administratören.

### C. Steg för steg

Kör i den här mappen (`worker-falt/`). Du behöver Node och samma
Cloudflare-konto som SMS-workern.

```bash
# 1. Logga in
npx wrangler login

# 2. Skapa databasen
npx wrangler d1 create autoads-falt
```

Klistra in `database_id` som kommandot skriver ut i `wrangler.toml`.

```bash
# 3. Skapa tabellerna
npx wrangler d1 execute autoads-falt --remote --file=./schema.sql

# 4. Hitta på en installationsnyckel (används en enda gång)
openssl rand -base64 24

# 5. Lägg in den som hemlighet
npx wrangler secret put INSTALL_NYCKEL

# 6. Publicera
npx wrangler deploy
```

Deploy skriver ut adressen, ungefär `https://autoads-falt.<konto>.workers.dev`.

```bash
# 7. Skapa den första administratören (byt ut nyckel, e-post och lösenord)
curl -X POST https://autoads-falt.<konto>.workers.dev/api/installera \
  -H "Content-Type: application/json" \
  -d '{"nyckel":"DIN_INSTALLATIONSNYCKEL","namn":"Emil","epost":"emil@autoads.se","losenord":"ett-langt-losenord"}'
```

**8.** Öppna `https://autoads.se/falt/` i mobilen, fyll i serveradressen från
steg 6 och logga in. Lägg sedan till appen på hemskärmen.

Därefter skapas alla andra användare inifrån appen under **Admin → Användare**.
`installera` slutar fungera så fort det finns en användare, så nyckeln kan inte
missbrukas i efterhand.

## Kom igång i appen

1. **Admin → Områden → Nytt område** — t.ex. "Västeråsvägen", ort "Västerås".
2. **Importera adresser** — hämta husnummer från kartan, eller klistra in listan.
3. **Tilldela säljare** — hoppa över steget om alla ska se området.
4. **Admin → Användare** — lägg upp säljarna.
5. **Admin → Regler & mål** — spärrtider, hit rate-definition och dagliga mål.

## Datamodell

| Tabell | Innehåll |
|---|---|
| `anvandare`, `sessioner` | Konton med roll (admin/teamleader/säljare), PBKDF2-hashade lösenord, sessioner giltiga 30 dagar |
| `omraden`, `omrade_saljare` | Områden och tilldelning |
| `adresser` | En rad per hus, med unik normaliserad nyckel, koordinater, status, senaste besök och spärr |
| `handelser` | Varje dörrbesök: resultat, anledning, återkomsttid, kommentar, GPS, tidsstämpel, säljare. Raderas aldrig |
| `bokningar` | Kund, telefon, datum, tid, status (bokad/genomförd/avbokad), kopplad till både adress och dörrbesök |
| `positioner` | Säljarnas senaste position |
| `installningar` | Spärregler, hit rate-definition och mål |

Kedjan säljare → område → adress → dörrbesök → resultat → bokning → genomfört
möte går alltid att följa: en bokning kan inte skapas utan att ett dörrbesök
registreras samtidigt.

## API

Alla anrop är `POST /api/<namn>` med JSON. Utom `logga-in` och `installera`
krävs `Authorization: Bearer <token>`.

| Endpoint | Roll | Beskrivning |
|---|---|---|
| `logga-in`, `logga-ut`, `jag`, `byt-losenord` | — | Konto och session |
| `omraden`, `adresser`, `adress` | säljare | Områden med bearbetningsgrad, dörrar, enskild dörr med historik |
| `handelse` | säljare | Registrerar ett dörrbesök. Svarar `409` med detaljer om dörren är fredad; skicka om med `bekrafta: true` |
| `aterbesok`, `nasta-dorr` | säljare | Arbetslistan och nästa rekommenderade dörr |
| `bokningar`, `bokning-status` | säljare | Bokningskalender och statusändring |
| `position` / `positioner` | säljare / teamleader | Skickar respektive hämtar säljarpositioner (senaste 30 min) |
| `dashboard`, `saljare-trend` | säljare | KPI:er, topplista, funnel, områdesresultat, veckotrend |
| `omrade-spara`, `omrade-tilldela`, `adresser-importera`, `anvandare-lista` | teamleader | Administration |
| `anvandare-spara`, `installningar-spara` | admin | Användare, spärregler, mål |

`GET /halsa` svarar utan inloggning och används för att kontrollera att workern
lever.

## Säkerhet

- Lösenord hashas med PBKDF2-SHA256, 100 000 varv och unikt salt per användare.
- Sessionstoken är slumpade, giltiga 30 dagar och raderas vid utloggning eller
  när admin byter någons lösenord.
- Inloggningen räknar alltid ut en hash, även för okänd e-post, så att
  svarstiden inte avslöjar vilka adresser som finns.
- CORS är begränsad till `autoads.se` och `localhost:8080`.
- Systemet innehåller kunduppgifter och GPS-positioner. Lägg inte in mer än
  bokningen kräver, och stäng av konton för den som slutar
  (**Admin → Användare → Ändra → Aktiv**) — det avslutar deras sessioner direkt.

## Underhåll

```bash
npx wrangler tail                      # loggar från den publicerade workern
npx wrangler d1 execute autoads-falt --remote \
  --command "SELECT gata, nummer, status, antal_besok FROM adresser WHERE omrade_id='...'"
```
