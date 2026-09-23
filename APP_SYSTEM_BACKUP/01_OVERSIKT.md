# 01 — Översikt

Fältsystemet är Villa Takrenoverings verktyg för dörrknackning och
takbesiktningar. Det är en app i telefonen (en PWA, installeras från
webbläsaren) och en server hos Cloudflare.

## Vem gör vad

- **Mötesbokaren** går från dörr till dörr. Vid varje dörr registreras ett
  utfall: *Bokat*, *Nej* eller *Inget svar*. Blir det Bokat väljs en dag,
  en tid och en besiktare, och sist kundens uppgifter.
- **Besiktaren** åker ut på mötena. Han lägger in de tider han jobbar,
  ser sina möten och lämnar omdöme efteråt: blev mötet av, och blev det jobb.
- **Admin Besiktare** leder besiktarna: styr deras scheman, arbetstider,
  orter och tak för antal möten per dag, ser alla bokningar och omdömen.
  Han är själv inte bokningsbar.
- **Mötesbokare+** ser och styr allt i appen: alla bokningar, dörrar,
  konton och scheman.

Ovanför dem finns *teamleader* och *admin* (administrationen), som har
full åtkomst. Se [03_ROLLER_OCH_BEHORIGHETER.md](03_ROLLER_OCH_BEHORIGHETER.md).

## Det viktigaste systemet gör

1. Visar dörrarna på en karta med deras senaste utfall i färg.
2. Bokar möten bara på tider som faktiskt går att boka — reglerna i
   [06_BOKNINGSREGLER.md](06_BOKNINGSREGLER.md) gäller överallt och i
   databasen själv, även när två bokar samtidigt.
3. Håller alla telefoner i laget på samma bild (se
   [13_REALTID_OCH_OFFLINE.md](13_REALTID_OCH_OFFLINE.md)).
4. Fungerar utan täckning: kartan och dörrarna laddas från telefonen, och
   registreringar köas tills nätet är tillbaka.

## Språk och stil

All kod, alla namn och kommentarer är på svenska. Kommentarerna förklarar
varför, inte vad. Reglerna för arbetet i repot står i `CLAUDE.md`.
