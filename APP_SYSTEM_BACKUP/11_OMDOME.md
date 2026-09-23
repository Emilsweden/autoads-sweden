# 11 — Omdöme efter mötet

När mötets starttid har passerat (svensk tid) väntar det på omdöme — utan
att någon först behöver markera det genomfört. Besiktarens *Mina möten*
öppnar då på fliken **Lämna omdöme (n)**, kortet säger LÄMNA OMDÖME och den
öppnade bokningen börjar med knappen.

## Formuläret

**Genomfördes bokningen?**

- **Ja** → Vad hände? · Var kunden intresserad? (Ja/Nej) · Blev det jobb?
  (Ja/Nej) · Ordervärde (om jobb). Bokningen blir *genomförd*.
- **Nej** → Varför inte? *Ingen hemma*, *Kunden avbokade*, *Kunden ringde
  och bokade om*, *Annat*. Bokningen blir *ej genomförd*. Vid *bokade om*
  går appen vidare till Redigera bokning; flyttas bokningen blir den bokad
  igen, med samma id.

Anteckningar finns i båda fallen.

## Alltid ändringsbart

Varje omdöme är en ny rad i `aterkoppling`; den senaste gäller och de
tidigare visas under *Tidigare omdömen*. *Ändra omdöme* finns kvar efteråt.

Utfallet härleds: jobb → Sålt, intresserad → Uppföljning, annars Inte sålt;
Ingen hemma → Kunden uteblev; övriga nej → Genomfördes inte.

## Vem

Besiktaren på sina egna möten. Admin Besiktare och Mötesbokare+ på alla.
Kommentarer och bilder läggs på bokningen och syns för alla som ser den,
bland dem Admin Besiktare och Mötesbokare+.
