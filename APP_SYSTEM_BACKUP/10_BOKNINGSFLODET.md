# 10 — Bokningsflödet och Redigera bokning

## Vid dörren: dörr → Bokat → dag → tid → besiktare → kund

1. **Dag**: bara dagar där någon som jobbar där huset ligger har en
   bokningsbar tid (`lediga-dagar` med dörrens `adress_id`).
2. **Tid och besiktare**: dagens bokningsbara tider, och under varje tid de
   besiktare som kan ta den.
3. **Kund**: förnamn, efternamn, mobil, adress, stege, kommentar. Spara.

**Tiden först**: överst i steg 1 finns *Passar en viss tid?*. Välj t.ex.
17:00 och appen visar dagarna de närmaste två månaderna då någon kan ta
17:00, och vem. Ett tryck går direkt till kunden.

Knappen Spara går inte att trycka två gånger, och registreringen bär ett
id från telefonen: kommer den fram två gånger sparas den en gång.

Från kalendern (Bokningar → Kalender) och *Manuell bokning* i Kommande går
samma regler; kalendern visar bara bokningsbara tider och ens egna
bokningar (Mötesbokare+ och Admin Besiktare allas).

## Redigera bokning

Samma formulär öppnas från dörren, kalenderns dag, Kommande, Månadslistan,
Skapade och Bokade adresser (`falt/js/redigera.js`). Det ersätter den gamla
Avboka-knappen.

Går att ändra: förnamn, efternamn, mobil, gata, husnummer, ort, lägenhet,
datum, tid och — för Mötesbokare+ och Admin Besiktare — besiktare. Tiderna
kommer från servern med bokningen själv borträknad, så den kan flyttas en
halvtimme utan att stå i vägen för sig själv.

- **Samma id**: en ombokning är samma bokning på en ny tid.
- **Säker**: flytten sker med reglerna i skrivningen; antingen hamnar den
  på den nya tiden, eller står den kvar orörd.
- **Rätt adress**: ändras adressen pekas bokningen och dess besök om till
  rätt dörr, och båda dörrarna räknas om.
- **Avboka mötet** och **Radera bokningen** finns i formuläret när servern
  säger att man får (flaggorna `far_avboka`, `far_radera`).
