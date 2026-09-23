# Ändringslogg

Nyast överst. Detaljerna står i commit-meddelandena (`git log`).

## 2026-09-23.1 — roller, bokningsregler och fältflödet

Den stora specifikationen. Inte utrullad än.

**Roller och behörigheter**
- Fyra roller i appen: Mötesbokare, Mötesbokare+ (översta), Besiktare, Admin Besiktare. Allt avgörs i servern.
- Admin Besiktare går inte att boka och har inget eget schema; lägger bara upp och ändrar besiktare; kan inte ändra roller; raderar inget.
- Mötesbokaren ser bara bokningsbara tider och sina egna bokningar, raderar egna bokningar före omdöme och dörrar bara han besökt.
- Bara Mötesbokare+ och Admin Besiktare byter besiktare på ett möte.

**Bokningsregler** (samma överallt, och i själva skrivningen)
- Arbetstid per besiktare (standard 09–18), blockerade tider med orsak, minst 3 timmar mellan möten, max per dag, inga tider som varit.
- Samtidiga bokningar kan inte tillsammans bryta mot reglerna; en nekad bokning lämnar inget besök och ingen grön dörr.

**Bokning**
- Redigera bokning ersätter Avboka: kund, telefon, adress, lägenhet, datum, tid, besiktare. Samma id vid ombokning.
- Tiden först: "Passar en viss tid?" visar dagarna och besiktarna.
- Orter per besiktare (Sala, Västerås, Köping, Örebro, Stockholm + egna); adressens kommun/postort/läge avgör vilka besiktare som visas.
- Husnummer med bokstav (12A, 12B är egna adresser); kommun sparas på adressen.

**Schema**
- Månadskalender med lägena Lägg till tider och Blockera tider, blockering för alla besiktare, standardtider med ett tryck.

**Efter mötet**
- Lämna omdöme när starttiden passerat: Genomfördes bokningen? Ja (vad hände, intresse, jobb, belopp) / Nej (ingen hemma, avbokade, bokade om, annat). Alltid ändringsbart.

**Nyheter och listor**
- Nya / Sedda, grupperat per vecka, Rensa allt per person, sammanslagna tidsnyheter.
- Ny vy Skapade: bokningar i den ordning de gjordes.
- Kommande utan Klistra in anteckningar.

**Kartan och dörrarna**
- Tre utfall: Bokat (grön), Nej (röd), Inget svar (gul). Nej och Inget svar med ett tryck. Återkom flyttas till Inget svar, historiken behålls.
- Radera dörren från markören; dörrar med historik döljs och kommer tillbaka om adressen skapas igen eller får ett besök.

**Realtid och robusthet**
- Ändringar och borttagningar når de andra telefonerna, inte bara nya rader.
- Dubbeltryck och kön utan nät ger en registrering, inte två; köade besök får tiden de gjordes.
- Två som skapar samma adress samtidigt får samma dörr (var ett serverfel).

**Utrullning**
- Nya kolumner och tabeller, migrering av arbetstid och Återkom, varning för möten hos Admin Besiktare.

**Övrigt**
- Alla ECC-agenter kör på Opus.
- Analysflödet för husnummer (`husnummer-analys.yml`) är borttaget; resultatet står i APP_SYSTEM_BACKUP/17.
- Systembeskrivning i APP_SYSTEM_BACKUP/, denna fil och APP_VERSION.md.

## 2026-09-23 — kartan
- Kartan ritas med OpenFreeMaps stil Liberty i appen, med husnummer; kartmotorn är utbytbar (Google förberedd, inte påslagen).
- ECC:s agenter, skills och kommandon, i ett urval.

## 2026-09-10 — Tiden och besiktaren
- Bokning i ordningen dag → tid → besiktare → kund; varje besiktare har sin egen dag.

## 2026-09-09
- Fyra roller och var sin kalender för säljarna; kalendern byggd på besiktarnas egna tider; Nyheter som egen flik; postnummer och adressökning.

## 2026-09-08
- Appen byggd kring kartan: husnummer, snabb status, en stil. Bokade adresser med kommentarer och bilder. Sju säkerhetshål stängda.

## 2026-08 och tidigare
- 2026-09-01: bokningskalender med gemensamma tider och skydd mot dubbelbokning.
- 2026-08-27: samma adress blir inte flera dörrar.
- 2026-08-25: MapLibre i stället för Leaflet.
- 2026-08-23: inklistrade anteckningar blir dörrar och besök.
- 2026-08-22: tryck på ett hus öppnar eller skapar dörren; appen serveras av workern.
- 2026-08-18: automatisk uppsättning av servern via GitHub Actions.
- 2026-08-17: första versionen av fältsystemet.
