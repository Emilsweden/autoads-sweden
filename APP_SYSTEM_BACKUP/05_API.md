# 05 — API

Alla anrop: `POST /api/<namn>`, JSON in och ut, token i
`Authorization: Bearer`. `GET /halsa` svarar `{ ok: true }` utan inloggning.
Behörigheten står i koden först i varje funktion; här sammanfattad.

## Konto och laget

| Anrop | Gör | Kräver |
|---|---|---|
| `installera` | Skapar första administratören | installationsnyckeln (en gång) |
| `logga-in`, `logga-ut` | Session | — |
| `jag` | Den inloggade, förmågor, arbetstid, inställningar | inloggad |
| `byt-losenord` | Byter lösenord, loggar ut andra telefoner | inloggad |
| `anvandare-lista` | Laget, med orter | `se_personal` |
| `anvandare-spara` | Lägger upp/ändrar konto, arbetstid, max per dag, orter | `skapa_konton`, eller `skapa_besiktare` (bara besiktare) |
| `anvandare-ta-bort` | Tar bort ett konto | `skapa_konton` |
| `anvandare-statistik` | Siffror för en person | `se_personal` |
| `platser` | Orterna och vem som jobbar var | `se_tider`, `eget_schema` eller `se_personal` |
| `plats-spara` | Ny eller ändrad ort | `styr_tider` |

## Dörrar

| Anrop | Gör | Kräver |
|---|---|---|
| `adresser` | Dörrarna i ens områden (inte raderade) | `knacka` |
| `adress` | En dörr, historik, bokningar, `far_radera` | `knacka` + området |
| `adress-ny` | Skapar eller återanvänder en dörr (tar tillbaka en raderad) | `knacka` |
| `handelse` | Registrerar ett besök — och vid Bokat bokningen | `knacka` + området |
| `adress-ta-bort` | Raderar dörren (döljer den om den har historik) | `radera`, eller `radera_egna` på egen dörr |
| `adress-andra`, `adresser-importera`, `omrade-*` | Rättelser och import | teamleader |
| `adresser-stada`, `installningar-spara` | Sammanslagning, regler | admin |
| `adress-sok`, `aterbesok`, `nasta-dorr`, `adress-broschyr` | Sök och arbetslistor | `knacka` |
| `anteckningar-importera` | Import av inklistrade anteckningar | `knacka` |
| `position`, `positioner` | Egen position / lagets | `knacka` / teamleader |

## Bokningar

| Anrop | Gör | Kräver |
|---|---|---|
| `lediga-dagar` | Dagar med bokningsbara tider (tar `adress_id`/`postort`) | `se_tider` |
| `bokbara-tider` | `{datum}` → tider och besiktare; `{tid, fran, till}` → dagar ("tiden först") | `se_tider`; besiktaren sina egna |
| `lediga-besiktare` | Vem kan ta en viss tid | `se_tider` |
| `kalender` | Bokningskalendern: bokningsbara tider, egna/alla bokningar | inloggad (innehållet efter roll) |
| `kalender-boka` | Bokar från kalendern (skapar dörren) | `boka` |
| `bokningar` | Bokningarna i ett intervall; `sortera: 'skapad'` för Skapade | inloggad (efter roll) |
| `bokade-adresser` | Bokningarna med kommentarer, bilder, omdömen, `lamna_omdome` | inloggad (efter roll) |
| `bokning-andra` | Redigera bokning; flytt med samma id | se [03](03_ROLLER_OCH_BEHORIGHETER.md) |
| `bokning-status` | Avboka / öppna igen | egen bokning eller `allt_bokat` |
| `bokning-ta-bort` | Raderar bokningen helt | `radera`, eller egen före omdöme |
| `bokning-kommentar`, `bokning-bilaga`, `bilaga` | Kommentarer och bilder | får se bokningen |
| `*-ta-bort` för kommentar/bild | Egen, eller `allt_bokat` | |
| `aterkoppling-spara` | Omdöme: `genomford`, `orsak`, `vad_hande`, `intresserad`, `blev_jobb`, `belopp`, `text` | egen besiktare, eller `aterkoppla_alla` |
| `aterkoppling` | Omdömena man får se | efter roll |

Varje bokningsrad bär flaggorna `far_andra`, `far_byt_besiktare`,
`far_avboka`, `far_radera`, `far_omdome`, `lamna_omdome`.

## Scheman

| Anrop | Gör | Kräver |
|---|---|---|
| `saljartider` | Scheman i ett intervall (≤ 62 dagar): inlagda, blockerade, bokat, bokbara, arbetstid, mall | `styr_tider` (alla) eller `eget_schema` (eget) |
| `saljartider-spara` | Sätter dagens inlagda tider; blockeringar rörs inte | eget schema eller `styr_tider` |
| `saljartid-andra` | `lage`: lagg_till, ta_bort, blockera, avblockera; `saljare_id: "alla"` för blockering av alla | eget schema eller `styr_tider` |
| `snabbtider-spara` | Besiktarens mall | eget schema eller `styr_tider` |

## Nyheter och realtid

| Anrop | Gör |
|---|---|
| `nyheter` | Flödet efter roll, utan det man svept bort eller rensat; `sedda_till` |
| `nyheter-sedda` | Flyttar fram ens seddamarkering (aldrig bakåt) |
| `nyheter-rensa` | Rensa allt — för en själv |
| `nyhet-dolj`, `nyhet-visa` | Svep bort / ångra |
| `puls` | Tidpunkten för senaste ändringen i systemet |
| `dashboard`, `saljare-trend` | Statistik (`se_personal`) |
