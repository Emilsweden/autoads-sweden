# Villa Takrenovering — fältsystemet: systembeskrivning

Den här mappen beskriver hela systemet så att det går att förstå, köra,
rulla ut och bygga vidare på utan att ha varit med när det byggdes. Den
innehåller inga hemligheter — lösenord och nycklar ligger bara i GitHub
(Settings → Secrets) och i Cloudflare, aldrig i repot.

Läs i ordning första gången. Varje fil står också för sig själv.

| Fil | Vad den beskriver |
|---|---|
| [01_OVERSIKT.md](01_OVERSIKT.md) | Vad systemet är till för och vilka som använder det |
| [02_ARKITEKTUR.md](02_ARKITEKTUR.md) | Delarna: app, worker, databas, och hur de hänger ihop |
| [03_ROLLER_OCH_BEHORIGHETER.md](03_ROLLER_OCH_BEHORIGHETER.md) | De fyra rollerna i appen och exakt vad var och en får |
| [04_DATAMODELL.md](04_DATAMODELL.md) | Tabellerna och kolumnerna |
| [05_API.md](05_API.md) | Alla anrop, vad de gör och vad de kräver |
| [06_BOKNINGSREGLER.md](06_BOKNINGSREGLER.md) | När en besiktare går att boka, och hur det skyddas |
| [07_SCHEMA_OCH_ARBETSTID.md](07_SCHEMA_OCH_ARBETSTID.md) | Besiktarnas tider, blockeringar, mall och arbetstid |
| [08_ORTER_OCH_ADRESSER.md](08_ORTER_OCH_ADRESSER.md) | Orter per besiktare, adresser, husnummer |
| [09_KARTAN.md](09_KARTAN.md) | Kartan, dörrarna och deras färger |
| [10_BOKNINGSFLODET.md](10_BOKNINGSFLODET.md) | Dörr → Bokat → dag → tid → besiktare → kund, och Redigera bokning |
| [11_OMDOME.md](11_OMDOME.md) | "Genomfördes bokningen?" — omdöme, kommentarer, bilder |
| [12_NYHETER.md](12_NYHETER.md) | Nyhetsflödet och vyn Skapade |
| [13_REALTID_OCH_OFFLINE.md](13_REALTID_OCH_OFFLINE.md) | Hur ändringar når andra telefoner, och kön utan nät |
| [14_TESTER.md](14_TESTER.md) | Testerna och hur de körs |
| [15_UTRULLNING.md](15_UTRULLNING.md) | Hur systemet sätts upp och rullas ut |
| [16_MIGRERINGAR.md](16_MIGRERINGAR.md) | Hur databasen ändras utan att riktiga data rörs |
| [17_KANDA_BEGRANSNINGAR.md](17_KANDA_BEGRANSNINGAR.md) | Det som inte finns, eller inte fungerar som man kan tro |
| [18_CURRENT_STATE.md](18_CURRENT_STATE.md) | Läget just nu: vad som är gjort och vad som återstår |

Versionen står i [../APP_VERSION.md](../APP_VERSION.md) och ändringarna i
[../CHANGELOG.md](../CHANGELOG.md).

## Snabbstart

    git clone <repot> && cd autoads-sweden
    ./tester/kor.sh                                   # alla tester, ska vara gröna
    node --disable-warning=ExperimentalWarning tester/server.mjs
    # → http://localhost:8787, databas i minnet. Första admin skapas med
    #   installationsnyckeln "test-installation".

Kräver Node 22 eller senare (för `node:sqlite`). Webbläsartesterna kräver
Playwright med Chromium och hoppas annars över.

## Att flytta systemet

Allt som behövs finns i repot: appen (`falt/`), servern (`worker-falt/`),
databasens schema (`worker-falt/schema.sql`), utrullningen
(`.github/workflows/satt-upp-faltsystemet.yml`) och testerna (`tester/`).
Utöver repot behövs ett Cloudflare-konto och hemligheterna som listas i
[15_UTRULLNING.md](15_UTRULLNING.md). Datan finns i Cloudflare D1 och följer
inte med repot — se [16_MIGRERINGAR.md](16_MIGRERINGAR.md) för export.
