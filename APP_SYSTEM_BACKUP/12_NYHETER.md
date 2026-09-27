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

## Bevakade konton

Administratören kan bevaka ett konto: *Bevaka — visa allt kontot gör i mina
nyheter* i användarformuläret. Bara administratören ser rutan, kan ändra
den och ser vem som är bevakad — inte ens en Mötesbokare+ som redigerar
konton kan slå av den.

Allt ett bevakat konto lyckas göra syns då i administratörens flöde:

- Det som redan blir en nyhet (raderad eller flyttad bokning, ändrade tider,
  omdöme, konto) står som vanligt — en gång.
- Det som annars är tyst får en egen rad av typen *aktivitet* (👁, blå kant):
  kommentarer med text, ändrad kund/telefon/adress/lägenhet/anteckning
  ("telefon 070-111 → 070-999"), bilder, Nej och Inget svar vid dörren, nya
  och rättade dörrar, broschyr, standardtider, orter, områden, import, regler.
- Nekade försök och att bara titta loggas inte.

Raderna syns bara för administratören (`rang admin`), aldrig för den
bevakade eller någon annan. Koden: `loggaAktivitet`, `beskrivAktivitet` och
`foreAktivitet` i routern.

## Räknaren

Knappen Nyheter visar hur många nyheter som kommit sedan man senast tittade.
Den räknas om när pulsen säger att något hänt, och försvinner när flödet öppnas.

## Skapade

Bokningar → **Skapade** (för dem som bokar): bokningarna i den ordning de
gjordes, grupperade per dag, med klockslaget de gjordes, mötesdagen och vem
som bokade. Mötesbokaren ser sina egna, Mötesbokare+ allas. *Visa äldre*
går upp till ett år bakåt. Bokningar som gjordes utan nät räknas från när
de gjordes.

## Kommande

Kommande listar kommande bokningar. Knappen *Klistra in anteckningar* är
borttagen därifrån; importkoden och dess anrop finns kvar men nås inte från appen.
