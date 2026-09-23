# 13 — Realtid och offline

## Pulsen

Appen frågar `puls` var tolfte sekund medan den syns. Svaret är tidpunkten
för det senaste som hänt. Har den ändrats hämtar den vy som syns om sig
själv — inte allt. Kalendern hämtar dessutom om var 20:e sekund medan den
är öppen.

Varje lyckat anrop som ändrar något stämplar tabellen `andringar` (routern
gör det, utom för anropen i `LASANDE`, som bara läser). Därför når också en
ändrad kund, en flyttad bokning eller en borttagen tid de andra — inte bara
nya rader. Nekade anrop stämplar inget. Går stämpeln inte att skriva loggas
det; anropet lyckas ändå.

## Servern är facit

All data ligger i D1. Telefonen visar det servern svarar; efter en ändring
ritas vyn om från servern. Schemat visar ett tryck direkt men ritar om när
kön av ändringar är tom, så att *Ledig* också betyder bokningsbar.

## Utan nät

- Appens skal och kartstil cachas av service workern (`falt/sw.js`,
  listan `SKAL`). Varje JS-fil appen laddar måste finnas där — ett test
  kontrollerar det.
- Dörrarna finns i telefonen; en dörr går att öppna och registrera utan nät.
- **Kön**: ett besök som inte når fram läggs i kön (`localStorage`) med
  tiden det gjordes (`ko_tid`) och sitt klient-id. Kön töms när nätet är
  tillbaka. Servern sparar besöket med den tiden (högst en vecka bakåt) och
  bara en gång per klient-id. Nekas en köad bokning för att tiden hunnit
  tas sparas besöket utan tid, så att det inte går förlorat.
- En äldre telefon som skickar *Återkom* får *Inget svar*.

## Dubbeltryck

Spara-knapparna går inte att trycka igen förrän servern svarat, och samma
registrering med samma klient-id ger samma svar i stället för en dubblett
— också när båda kommer fram samtidigt. Ett klient-id ger bara tillbaka
ens egen registrering.
