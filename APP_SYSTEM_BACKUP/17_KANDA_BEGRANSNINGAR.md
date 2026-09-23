# 17 — Kända begränsningar

Det som inte finns, eller inte fungerar som man kan tro.

## Funktioner som inte finns

- **Påminnelser.** `wrangler.toml` har en cron-trigger varje minut, men
  workern har ingen `scheduled`-funktion. Inga påminnelser skickas. Antingen
  byggs de, eller tas cron-raden bort.
- **E-post** till besiktaren vid ny bokning fungerar bara när
  `EPOST_NYCKEL` och `EPOST_AVSANDARE` är satta. Utan dem skickas inget.
- **Googles karta** är förberedd men inte påslagen; kartan är OpenFreeMap.
- **Klistra in anteckningar** nås inte längre från appen. Koden
  (`falt/js/anteckningar.js`, `anteckningar-importera`) finns kvar.
- **Logotypen** är en platshållare (`falt/logotyp.svg`); bytet är den filen.

## Husnummer i Örebro

Kartan visar husnumren som finns i OpenStreetMap. Mätt i september 2026:
Örebro kommun har cirka 5 500 adresspunkter där, Västerås 24 000. I
Rynninge saknade 97 % av villorna ett husnummer inom 30 m, i Lillån 67 %.
OpenAddresses har ingen källa för Örebro län. Den kompletta källan är
Lantmäteriets Belägenhetsadress, som kräver konto på Geotorget — det har
valts bort. Husnummer som saknas skrivs in vid dörren.

## Beteenden värda att känna till

- **Reglerna gäller nya och flyttade bokningar.** En gammal bokning som
  bryter mot tretimmarsregeln eller taket står kvar och går att redigera.
- **En besiktare utan orter** kan bokas överallt.
- **Admin Besiktare går inte att boka.** Kommande möten som redan ligger
  på ett sådant konto rörs inte av utrullningen och måste flyttas för hand.
- **En köad bokning** vars tid hunnit tas av någon annan sparas utan tid.
- **Intervall**: lediga dagar räknas högst 190 dagar i ett anrop, scheman
  högst 62 dagar.
- **Bilder** sparas i databasen som data-URL:er (nedskalade, max 20 per
  bokning). Många bilder gör databasen stor; en objektlagring (R2) vore
  nästa steg om det blir ett problem.
- **Adressuppslag** går till OpenStreetMaps Nominatim, som är gratis men
  begränsat; appen cachar uppslagen medan den är igång.
- **Tider** räknas i svensk tid (Europe/Stockholm) i servern.
