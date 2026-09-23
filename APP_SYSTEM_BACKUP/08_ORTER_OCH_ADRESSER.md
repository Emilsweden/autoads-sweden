# 08 — Orter och adresser

## Orter per besiktare ("Tillgänglig i")

Tabellen `platser` har orterna: Sala, Västerås, Köping, Örebro och
Stockholm från början, med centrum och radie. Nya läggs till i
användarformuläret ("Lägg till ort"); läget slås upp hos OpenStreetMap.
Varje besiktare kopplas till sina orter (`besiktare_platser`).

**En besiktare utan orter kan bokas överallt.** Så blir ingen obokbar bara
för att orterna inte satts.

## Vilken ort en adress hör till

`platserForAdress()`:

1. Adressens **kommun** eller **postort** jämförs med orternas namn och
   kommun. Träff → de orterna.
2. Annars, om adressen har ett **läge**, den närmaste ort vars radie
   adressen ligger inom.
3. Annars går orten inte att avgöra, och alla besiktare visas.

En adress i Sala hör alltså till Sala även om den råkar ligga närmare
Västerås centrum.

Ortfiltret används av allt som visar tider när en adress är känd (dörrens
`adress_id`, eller `postort`/`kommun`/`lat`/`lon`), och servern vägrar boka
eller flytta ett möte till en besiktare som inte jobbar där ("X jobbar inte
i Sala"). Den som skickar ett `adress_id` måste få se dörren.

## Adresser

- Gata, nummer, postnummer, postort och **kommun** sparas separat, liksom
  läget. Kommunen kommer från OpenStreetMap ("Sala kommun" sparas som Sala).
- **Husnummer skrivs som på huset**: "12 a" blir 12A. 12, 12A och 12B är
  tre olika adresser. Fälten för husnummer tar bokstäver på telefonen.
- Nyckeln (`nyckel`) ignorerar mellanslag, skiljetecken och versaler, så
  "Vinkel gatan 3" och "Vinkelgatan 3" blir samma dörr. Samma gata i två
  orter är två dörrar.
- Två som skapar samma adress samtidigt får samma dörr.
- En raderad dörr med historik döljs (`dold`); skapas adressen igen, eller
  registreras ett besök på den, kommer den tillbaka med sin historik.

## Husnummer på kartan

Kartan visar husnumren som finns i OpenStreetMap. I Örebro saknas många —
se [17_KANDA_BEGRANSNINGAR.md](17_KANDA_BEGRANSNINGAR.md).
