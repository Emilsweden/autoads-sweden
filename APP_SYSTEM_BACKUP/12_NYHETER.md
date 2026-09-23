# 12 — Nyheter och Skapade

## Nyhetsflödet

Varje händelse (bokning, flytt, avbokning, omdöme, tider, blockering,
konto) blir en rad i `nyheter`. Vem som ser vad avgörs i servern: Mötesbokare+
allt, Admin Besiktare allt som rör besiktarna, besiktaren det som rör honom,
mötesbokaren det han gjort och det som hänt med hans bokningar.

- **Nya / Sedda**: det som hänt efter ens `nyheter_sedda` står under *Nya*.
  När vyn visats markeras det som sett, men gränsen står still medan man
  läser.
- **Grupper**: *Den här veckan*, *Förra veckan*, *Äldre*.
- **Rensa allt**: sätter ens `nyheter_rensade`; flödet töms för en själv,
  alla andra har kvar sitt. Det som händer efteråt syns igen.
- **Svep bort** en enskild nyhet — bara för en själv.
- **Ingen spam**: tider som läggs in eller blockeras i rad av samma person
  för samma besiktare och dag inom en kvart blir **en** nyhet med alla
  tiderna ("Alma lade till Karls tider 2026-10-01 — 09:00, 12:00, 15:00").

## Skapade

Bokningar → **Skapade** (för dem som bokar): bokningarna i den ordning de
gjordes, grupperade per dag, med klockslaget de gjordes, mötesdagen och vem
som bokade. Mötesbokaren ser sina egna, Mötesbokare+ allas. *Visa äldre*
går upp till ett år bakåt. Bokningar som gjordes utan nät räknas från när
de gjordes.

## Kommande

Kommande listar kommande bokningar. Knappen *Klistra in anteckningar* är
borttagen därifrån; importkoden och dess anrop finns kvar men nås inte från appen.
