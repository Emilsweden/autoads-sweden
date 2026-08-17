# Dörrknackning — säljverktyg

Mobilanpassad webbapp för att registrera dörrknackning när du säljer gratis
besiktningsbokningar. All data sparas **lokalt i telefonen** (localStorage) —
ingen server, inget konto, inga personuppgifter lämnar enheten.

**URL:** https://autoads.se/dorrknackning/

## Så används den

1. Öppna länken i mobilen och välj **Lägg till på hemskärmen** — då startar den
   som en vanlig app, i helskärm och utan adressfält.
2. Efter varje dörr: tryck **Ny registrering**, välj utfall och spara.

### Utfall

| Utfall | Vad som händer |
|---|---|
| **Bokad** | Besiktningen läggs som bokning på valt datum och tid. |
| **Ej svar** | Adressen hamnar under *Återkoppling* med datum för nytt besök. |
| **Ska tänka** | Samma som ovan — adressen ligger kvar för uppföljning. |
| **Ej intresse** | Registreras utan datum, syns bara under *Alla*. |

### Vyer

- **Idag** — dagens bokningar plus återkopplingar som förfallit (markerade
  *Att göra nu*).
- **Bokningar** — alla inbokade besiktningar, äldst datum först.
- **Återkoppling** — adresser där ingen svarade eller som ska tänka på saken.
- **Alla** — hela registret, sökbart på adress, namn, telefon och anteckning.

### Bra att veta

- **Samma adress igen:** registrerar du en adress som redan finns öppen så
  uppdateras den posten i stället för att bli en dubblett. Besöksräknaren tickar
  upp (*2 besök*) och den nya anteckningen läggs till under den gamla.
- **Ring / Karta** öppnar telefonens ringfunktion respektive Google Maps.
- **Kalender** laddar ner en `.ics`-fil för bokningen med påminnelse en timme
  innan.
- **Boka in** flyttar en återkoppling till en riktig bokning.
- Appen fungerar **utan täckning** — allt sparas lokalt och synkas inte.

## Säkerhetskopiering

Data ligger bara i den webbläsare du använder. Rensar du webbläsardata eller
byter telefon försvinner registret. Under menyn (☰) finns:

- **Exportera CSV** — öppnas i Excel eller Google Kalkylark.
- **Säkerhetskopiera** — laddar ner all data som JSON-fil.
- **Återställ från fil** — läser in en säkerhetskopia. Poster som redan finns
  hoppas över, så det går att slå ihop data från två telefoner.

Ta en säkerhetskopia med jämna mellanrum, till exempel varje fredag.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html` | Hela appen — HTML, CSS och JS i en fil. |
| `sw.js` | Service worker, gör appen användbar offline. |
| `manifest.webmanifest` | Gör att appen kan installeras på hemskärmen. |
| `icon.svg`, `icon-maskable.svg` | Appikon. |

Sidan är `noindex` och länkas inte från autoads.se, men den är publikt nåbar för
den som känner till adressen — lägg därför inte in känsliga uppgifter om kunder
utöver det som behövs för bokningen.

### Ändra appen

Öppna `index.html` lokalt i webbläsaren, eller kör en lokal server från
repo-roten:

```bash
npx http-server . -p 8080
# http://localhost:8080/dorrknackning/
```

Ändrar du `index.html` behöver `CACHE`-namnet i `sw.js` bytas (`dorrknack-v1` →
`dorrknack-v2`) så att installerade appar hämtar den nya versionen.
