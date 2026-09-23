# 03 — Roller och behörigheter

Rollerna har databasnamn som funnits sedan början och namn som laget använder:

| `roll` i databasen | Namn i appen | Rang |
|---|---|---|
| `saljare` | Mötesbokare | 1 |
| `besiktare` | Besiktare | 1 |
| `saljadmin` | Admin Besiktare | 2 |
| `bokare_plus` | Mötesbokare+ | 2 |
| `teamleader` | Teamleader | 3 |
| `admin` | Admin | 4 |

Rangen används av äldre kontroller (områden, import, inställningar). Det
som skiljer rollerna i sidled är **förmågorna** i `FORMAGOR`
(`worker-falt/src/index.js`). En okänd roll får inga förmågor.

## Förmågorna

| Förmåga | Betyder | Har |
|---|---|---|
| `knacka` | karta, dörrar, adressregister | Mötesbokare, Mötesbokare+ |
| `boka` | lägga en bokning | Mötesbokare, Mötesbokare+ |
| `se_tider` | se bokningsbara tider | Mötesbokare, Mötesbokare+, Admin Besiktare |
| `styr_tider` | styra alla besiktares scheman, orter | Mötesbokare+, Admin Besiktare |
| `eget_schema` | styra sitt eget schema | Besiktare |
| `allt_bokat` | se och ändra alla bokningar | Mötesbokare+, Admin Besiktare |
| `byt_besiktare` | flytta ett möte till en annan besiktare | Mötesbokare+, Admin Besiktare |
| `aterkoppla` | omdöme på sina egna möten | Besiktare |
| `aterkoppla_alla` | omdöme på alla möten | Mötesbokare+, Admin Besiktare |
| `all_aterkoppling` | se all återkoppling | Mötesbokare+, Admin Besiktare |
| `radera` | radera bokningar och dörrar | Mötesbokare+ |
| `radera_egna` | radera egna bokningar (före omdöme) och dörrar bara man själv besökt | Mötesbokare |
| `skapa_konton` | lägga upp lagets konton | Mötesbokare+ |
| `skapa_besiktare` | lägga upp och ändra besiktarkonton — bara dem | Admin Besiktare |
| `se_personal` | se laget och statistiken | Mötesbokare+, Admin Besiktare |

Teamleader och admin har `*` (allt).

## Vad varje roll får — sammanfattat

**Mötesbokare**: bokar; ser bara bokningsbara tider och sina egna bokningar;
redigerar och flyttar sina bokningar i tid (hos samma besiktare); raderar
sina bokningar tills mötet fått omdöme; raderar dörrar bara han besökt.
Ser inga scheman, skapar inga konton.

**Mötesbokare+**: allt ovan för alla; byter besiktare; raderar alla
bokningar och dörrar; lägger upp mötesbokare, besiktare, Admin Besiktare
och Mötesbokare+ (inte teamleader/admin); styr alla scheman och orter.

**Besiktare**: ser och styr bara sitt eget schema; ser och redigerar bara
sina egna möten (inte besiktare på dem); lämnar omdöme på sina möten;
bokar och raderar inget.

**Admin Besiktare**: styr alla besiktares scheman, arbetstid, max per dag
och orter; ser och redigerar alla bokningar; byter besiktare; lämnar omdöme
på alla möten; lägger bara upp *besiktare* och ändrar bara besiktarkonton —
kan inte ge någon en annan roll, inte ändra sitt eget konto. **Går inte att
boka** och har inget eget schema. Raderar inga bokningar, dörrar eller konton.

## Var kontrollerna sitter

`kraverFormaga`, `kraverKnackare`, `kraverStatistik`, `kraver` (rang),
`adressJagFar` (dörren ligger i ens områden), `bokningsvillkor` (vilka
bokningar man ser), `farSeBokning`, `farAndraBokning`, `farBytaBesiktare`,
`farRadera`, `farRaderaDorr`, `schemaJagFar`. Flaggorna till appen byggs av
`flaggor()`. Allt prövas i `tester/roller.test.mjs` och `behorighet.test.mjs`.
