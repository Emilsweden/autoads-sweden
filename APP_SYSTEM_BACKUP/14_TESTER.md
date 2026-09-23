# 14 — Tester

    ./tester/kor.sh                    # alla
    ./tester/kor.sh tester/regler.test.mjs   # en fil (via node --test)

`kor.sh` kör `node --test` på `tester/*.test.mjs`. Node 22+. Filerna
startar var sin server på en ledig port med en tom databas i minnet.

## Testservern (`tester/server.mjs`)

Kör workern som den är, med en D1-liknande databas ovanpå `node:sqlite`
(`prepare/bind/all/first/run` och `batch` som transaktion). Varje fråga
väntar en tur (`setImmediate`) som över nätet, så samtidiga förfrågningar
verkligen blandas — utan det prövade racetesterna ingenting. Servern
serverar också appen och skriver om `config.js` så att appen pratar med
den. Utgående mejl fångas (`brevlada`). `EFTER_SCHEMAT` är indexen som
utrullningen lägger på efter schemat.

    node --disable-warning=ExperimentalWarning tester/server.mjs   # http://localhost:8787

## Filerna

| Fil | Prövar |
|---|---|
| `roller.test.mjs` | De fyra rollerna mot API:t, en för en |
| `behorighet.test.mjs` | Områden, konton, trasig roll, lösenord, nyheter, klient-id, ortläckor |
| `regler.test.mjs` | Scenario A–F, 3 timmar, blockering, samtidiga bokningar, tiden först |
| `platser.test.mjs` | Scenario G, orter, husnummer med bokstav, kommun |
| `bokning.test.mjs` | Äldre bokningstester, mejl, och att schema/workflow inte glidit isär |
| `omdome.test.mjs` | Lämna omdöme, Ja/Nej, ändra, bokade om |
| `nyheter.test.mjs` | Nya/Sedda, Rensa allt, ingen spam, Skapade |
| `realtid.test.mjs` | Pulsen, dubbeltryck, köns tid |
| `markorer.test.mjs` | Tre utfall, Återkom, radera dörr |
| `appen.test.mjs` | Webbläsaren: navigering, bokningsflödet, redigera, schemat, tiden först, omdöme, Skapade, nyheter |
| `karta.test.mjs` | Webbläsaren: kartan, dörrar, husnummer, NEJ med ett tryck, radera, stil, offline |

Webbläsartesterna kräver Playwright med Chromium och hoppas annars över.

## Arbetsgången

Test först, sedan koden (se `CLAUDE.md`). Nya regler i servern får ett
API-test; ändringar i flöden i appen ett i `appen.test.mjs`. De viktigaste
skydden har prövats genom att ta bort dem och se att testet faller.
