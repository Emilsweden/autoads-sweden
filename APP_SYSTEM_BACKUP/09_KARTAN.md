# 09 — Kartan

## Motorn och stilen

Kartan ritas med **MapLibre** (i appen, `falt/maplibre/`) i OpenFreeMaps
stil **Liberty**, som också ligger i appen (`falt/kartstil/liberty.json`,
från hyperknot/openfreemap-styles, MIT). Kartbilderna hämtas från
`tiles.openfreemap.org` — gratis, utan konto och nyckel. Stilen har ett
eget lager `husnummer` som visar OpenStreetMaps husnummer från zoom 17.
Utan täckning startar kartan ändå: dörrarna syns, kartbilden blir tom.

`falt/js/kartmotor.js` är det enda som vet vilken motor som ritar.
Googles karta kan kopplas in (`GOOGLE_MAPS_NYCKEL`, `GOOGLE_MAPS_KARTID`
som GitHub-hemligheter) men är inte påslagen; ägaren har valt att behålla
kartans nuvarande utseende.

## Dörrarna

Dörrarna är ett eget lager (`dorrar`) med en prick per dörr, färgad efter
status:

| Status | Färg |
|---|---|
| Ej besökt | vit med svart kant |
| Bokat | grön `#1e9e4a` |
| Nej | röd `#d42b1f` |
| Inget svar | gul `#f2b705` |
| Nyligen besökt (spärrad) | grå kant |

Återkom finns inte längre; en dörr som ännu står på det ritas gul.
Färgerna finns i `STATUS_FARG` (`ui.js`) och `.hus-nummer.s-*` (`app.css`).

## Vid dörren

Ett tryck på en prick öppnar dörren: **BOKAT** över hela bredden, **NEJ**
och **INGET SVAR** under. Nej och Inget svar sparas direkt — inga
följdfrågor. Bokat startar bokningsflödet
([10_BOKNINGSFLODET.md](10_BOKNINGSFLODET.md)).

**Radera dörren** finns längst ned för den som får (Mötesbokare+ alla,
mötesbokaren dörrar bara han besökt). En dörr med ett kommande möte kan
inte raderas.

Ett tryck på ett husnummer från OpenStreetMap (blå ring) skapar dörren med
adressen ifylld. Ett tryck bredvid ett hus föreslår huset.
