# 06 — Bokningsreglerna

En tid hos en besiktare går att boka när **alla** gäller:

1. Tiden är **inlagd** i hans schema (`saljartider.ledig = 1`).
2. Den är **inte blockerad** (en blockering är samma rad med `ledig = 0`).
3. Den ligger **inom hans arbetstid** — från och med `arbetstid_fran` till
   och med `arbetstid_till` (standard 09:00–18:00; 18:00 går att boka).
4. Den har **inte redan varit** (svensk tid, minutupplöst).
5. Den ligger **minst 3 timmar** från varje annat möte han har samma dag,
   åt båda hållen (`|t − möte| ≥ 180 min`).
6. Han har **inte fullt**: antalet möten den dagen (inte avbokade) är under
   hans `max_per_dag`.
7. Han **jobbar där huset ligger**, om adressen är känd och han har orter
   (se [08_ORTER_OCH_ADRESSER.md](08_ORTER_OCH_ADRESSER.md)).
8. Han är **besiktare** och aktiv. Admin Besiktare går inte att boka.

## Samma regler överallt

Reglerna finns på två ställen, med samma innehåll:

- `raknaBokbara()` i JavaScript — används av allt som *visar* tider:
  `lediga-dagar`, `bokbara-tider`, `lediga-besiktare`, `kalender`,
  `saljartider`, och förkontrollen `valjSaljare()`.
- `bokbarVakt()` i SQL — sitter i `WHERE` på själva skrivningen:
  `INSERT INTO bokningar … SELECT … WHERE <vakt>` i `handelse`, och
  `UPDATE bokningar … WHERE id = ? AND <vakt>` i `bokning-andra`.

Scenarierna A–G i `tester/regler.test.mjs` och `platser.test.mjs` prövar
båda: det som erbjuds och det som går att spara.

## Varför i skrivningen

Två mötesbokare som trycker samtidigt kan båda se tiden som ledig. Det unika
indexet stoppar bara *exakt samma* tid hos samma besiktare. Med vakten i
`WHERE` räknas taket och tretimmarsregeln i samma ögonblick som raden
skrivs: den som kommer andra får 0 ändrade rader och ett begripligt 409
från `varforInteBokbar()` ("har fullt", "har ett möte kl. 12:00 — minst 3
timmar", "blockerad", "utanför arbetstiden", "Tiden är redan bokad").

Bokningen, besöket och dörrens nya status skrivs i **en D1-batch**
(transaktion). Besöket och dörren skrivs bara om bokningsraden finns, så
en nekad bokning lämnar inga spår.

## Exempel (scenarierna)

- **A** Max 2, tider 09/12/15/18. 09 och 12 bokade → dagen är full, 15 och
  18 erbjuds inte, en tredje bokning nekas.
- **B** 09 avbokas → 09 går att boka igen.
- **C** 12 flyttas till 15 → samma boknings-id, 12 blir fri.
- **D** Max 3 → exakt tre.
- **E** Två besiktare kl. 13:00 påverkar inte varandra.
- **F** Arbetstid 12–20 → 09–11 syns inte och går inte att lägga in.
- **G** En besiktare i Sala syns för en adress i Sala men inte i Stockholm.

## Befintliga bokningar

Reglerna prövas när en bokning skapas eller flyttas. En gammal bokning som
redan bryter mot en regel går att redigera (namn, telefon …) utan att den
nekas, så länge den inte flyttas.
