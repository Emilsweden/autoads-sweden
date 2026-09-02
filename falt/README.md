# Autoads Fältsystem

Digitalt kontrollsystem för dörrknackning, områdeskontroll och bokning av
takbesiktningar. Mobilanpassat för säljaren på gatan, men fungerar lika bra på
surfplatta och kontorsskärm.

**URL efter publicering:** https://autoads.se/falt/
**Server:** sätts upp enligt `worker-falt/README.md` (Cloudflare Worker + D1).

## Så jobbar säljaren

Flödet framför dörren är **tryck på adress → välj resultat → klart**.

| Knapp | Vad som händer |
|---|---|
| **BOKAT** | Formulär för förnamn, efternamn, mobil, datum och kommentar. Tiden väljs bland dagens lediga rutor i kalendern. Adressen blir Bokad. |
| **INGET SVAR** | Välj när vi återkommer: senare idag, ikväll, imorgon, i helgen, egen tid eller ingen återkomst. |
| **NEJ** | Välj anledning. Vill kunden att vi hör av oss senare finns knappen "Kunden vill att vi återkommer". |
| **ÅTERKOM** | Välj tidpunkt: ikväll, imorgon, i helgen, nästa vecka, om två veckor eller egen tid. |

Två tryck räcker för allt utom bokningar. Varje registrering stämplas med
säljare, tidpunkt och GPS-position.

## Vyer

- **Karta** — alla hus i området som färgade punkter. Knappen *Nästa dörr* väljer
  automatiskt närmaste obesökta adress som inte är fredad.
- **Dörrar** — återbesök (försenade överst), ej besökta och hela registret, sökbart.
- **Bokningar** — kalender med lediga och bokade tider, samt listan över bokade
  besiktningar med ring, karta, markera genomförd och avboka.
- **Dashboard** — KPI:er, topplista, funnel, områdesresultat, mål och utmärkelser.
- **Admin** — områden, adressimport, användare samt spärregler och mål.

### Färger på kartan

🔵 Ej besökt · 🟢 Bokad · 🟡 Inget svar · 🟠 Återkom · 🔴 Nej · ⚪️ ring runt punkten = fredad

## Bokningskalendern

Besiktningarna bokas i rutor, inte som fritext. Under **Bokningar** ligger
kalendern först och den filtrerbara listan bredvid. Månadsvyn visar antalet
bokningar per dag; en dag öppnar 08:00–20:00 i halvtimmesrutor. En ledig ruta
öppnar ett formulär (kund, adress, telefon, säljare, anteckning), en tagen ruta
visar vem som bokat och åt vem. Den som äger bokningen kan avboka den, och då
blir rutan ledig igen.

Samma rutor gäller vid dörren: **BOKAT** erbjuder dagens lediga tider i stället
för ett fritt klockslag, så en dörrbokning hamnar i kalendern.

Två säljare kan aldrig sälja in samma tid. Databasen har ett unikt index på
datum och tid, så av två bokningar som kommer samtidigt går en igenom och den
andra får *Tiden är redan bokad – välj en annan tid*, varefter rutan visas röd
med vem som tog den. Servern kontrollerar dessutom helg, öppettider och att
tiden börjar på en hel ruta, oavsett vad appen skickar. Kalendern hämtas om var
20:e sekund medan den syns, så en tid någon annan tar försvinner utan att sidan
laddas om.

Öppettider, rutornas längd och bokningsbara veckodagar ändras på ett ställe —
`KALENDER` i `worker-falt/src/index.js`. Appen ritar rutnätet efter vad servern
svarar, så den kan aldrig erbjuda en tid servern ändå nekar.

## Skydd mot dubbelbearbetning

Öppnar en säljare en dörr som någon annan redan tagit visas direkt vem som
besökte den, när, vad resultatet blev och vad nästa åtgärd är. Försöker han
registrera ett nytt besök på en fredad dörr kommer en varning som måste
bekräftas innan besöket sparas.

Hur länge en dörr är fredad ställs in under **Admin → Regler & mål** (förval:
180 dagar efter nej, 1 dag efter inget svar, 365 dagar efter bokning). Vid
*Återkom* är dörren fredad fram till den tidpunkt säljaren valt.

## Utan täckning

Dörrar som redan hämtats går att öppna och registrera även utan nät.
Registreringen hamnar i en kö — en gul markering uppe till höger visar hur många
som väntar — och skickas upp automatiskt när telefonen får nät igen. Historiken
kan inte visas offline.

Bokningar går att spara utan nät, men då kan de lediga rutorna inte hämtas.
Bokningen sparas då utan klockslag och får sin tid i kalendern när kön gått upp
— kundens namn och nummer är värt mer än klockslaget. Hinner någon annan ta
tiden medan telefonen är offline behålls besöket, och det är bara tiden som
faller bort.

## Hit rate

Hit rate = bokade möten delat med nämnaren som administratören valt:

- **Alla knackade dörrar** (förval)
- **Dörrar där någon öppnade** — allt utom "inget svar"
- **Positiva samtal** — bokat eller återkom

Det gör att man kan mäta säljarens faktiska konverteringsförmåga och inte bara
hur många dörrar han hinner med.

Funneln visar dörrar → öppnade → positiva samtal → bokade → genomförda.
Observera att *genomförda* räknas på mötets datum, medan resten räknas på
knackningsdagen — ett möte bokat idag syns alltså som genomfört först den dag
det äger rum.

## Adressimport

Under **Admin → Områden → Importera adresser** finns två vägar:

1. **Hämta från kartan** — ange gata och ort, så hämtas alla husnummer med
   koordinater från OpenStreetMap. Det ger punkter på kartan direkt.
2. **Klistra in** — en adress per rad, eller kortformen `Västeråsvägen 1,3,5,7,9`.
   Inklistrade adresser saknar koordinater och syns därför i listorna men inte på
   kartan förrän de kompletteras via kartimporten.

Adresser normaliseras (gata, nummer, postort) och är unika i hela systemet, så
`Västeråsvägen 1` och `västeråsvägen  1` blir samma dörr oavsett vem som skriver
in den.

## Roller

| Roll | Kan |
|---|---|
| **Säljare** | Se tilldelade områden, registrera dörrar, skapa bokningar, se dörrarnas historik och sin egen statistik. |
| **Teamleader** | Allt ovan, plus alla områden, alla säljares statistik, säljarnas positioner på kartan, områdesadministration och adressimport. |
| **Admin** | Allt ovan, plus användare, roller, spärregler, hit rate-definition och mål. |

Ett område utan tilldelade säljare syns för alla — det gör att systemet fungerar
direkt efter import, innan tilldelningen är gjord.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html`, `app.css` | Skal och design |
| `js/app.js` | Inloggning, navigering, GPS, kö |
| `js/dorr.js` | Dörrpanelen — registreringsflödet och historiken |
| `js/karta.js` | Kartan, säljarpositioner, nästa dörr |
| `js/geo.js` | Adressdelning, vägbeskrivning, kartappar |
| `js/kalender.js` | Bokningskalendern — månad, tidsrutor, boka och avboka |
| `js/listor.js` | Dörrlistor och bokningslistan |
| `js/anteckningar.js` | Inklistrade fältanteckningar till dörrar och besök |
| `js/dashboard.js` | KPI:er, topplista, funnel, jämförelser |
| `js/admin.js` | Områden, adressimport, användare, regler |
| `js/api.js` | Serveranrop och offlinekö |
| `js/state.js`, `js/ui.js` | Delat tillstånd, paneler och datumhjälp |
| `sw.js` | Gör appen öppningsbar utan täckning |

Utveckla lokalt från repo-roten:

```bash
npx http-server . -p 8080   # http://localhost:8080/falt/
```

Servern måste tillåta anropet — `http://localhost:8080` ligger redan i workerns
lista över tillåtna adresser.
