# 18 — Nuläge

*Skrivet 2026-09-23, uppdaterat 2026-09-28.*

## Kod

- Arbetsgren: `claude/door-knock-sales-app-1oegem`. Version 2026-09-23.1
  rullades ut från grenen 2026-09-23 16:06. `main` ligger efter.
- 2026-09-27: bevakade konton och räknaren på Nyheter (version 2026-09-27.1),
  utrullad 2026-09-27 13:20.
- 2026-09-28: veckonummer i alla kalendrar och vid alla datum (version 2026-09-28.1).
- Tester: 137, alla gröna (`./tester/kor.sh`), inklusive webbläsartester.
- Granskat av kodgranskare, säkerhetsgranskare och en genomgång av tysta
  fel; allt som hittades är rättat och har tester.

## Byggt i den här omgången (den stora specifikationen, 51 punkter)

| Område | Läge |
|---|---|
| Roller: Mötesbokare, Mötesbokare+, Besiktare, Admin Besiktare | klart, i servern |
| Admin Besiktare inte bokningsbar, skapar bara besiktare | klart |
| Redigera bokning (ersätter Avboka), samma id vid ombokning | klart |
| Max per dag, 3 timmar mellan möten, blockering, arbetstid, racesäkert | klart |
| Schemat som månadskalender, Lägg till / Blockera, mall, blockera för alla | klart |
| Orter per besiktare, ort från kommun/postort/GPS, husnummer med bokstav | klart |
| Tiden först ("17:00 passar") | klart |
| Omdöme: Genomfördes bokningen? Ja/Nej, alltid ändringsbart | klart |
| Skapade-vy, Kommande utan Klistra in | klart |
| Nyheter: Nya/Sedda, veckogrupper, Rensa allt, ingen spam | klart |
| Dörrar: Bokat/Nej/Inget svar, ett tryck, radera från markören, Återkom → Inget svar | klart |
| Realtid för ändringar, dubbeltryck, köns tid | klart |
| Kartans utseende | oförändrat, enligt ägarens val |
| Google Maps | hoppades över, enligt ägarens val |
| E-post (P5) | inte nu |

## Återstår / beslut hos ägaren

1. **Utrullning** av grenen: Actions → Sätt upp fältsystemet. Se först om
   Admin Besiktare har kommande möten (utrullningen varnar).
2. Koppla orter till besiktarna i appen (utan orter kan de bokas överallt).
3. Lägga in arbetstider om de skiljer sig från 09–18.
4. Påminnelser: bygga dem eller ta bort cron-raden.
5. E-posthemligheter, riktig logotyp.
