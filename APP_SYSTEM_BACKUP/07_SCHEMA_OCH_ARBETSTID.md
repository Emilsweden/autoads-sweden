# 07 — Schema och arbetstid

## Arbetstid

Varje besiktare har en arbetstid (`arbetstid_fran`–`arbetstid_till`,
standard 09:00–18:00). Den ställs i användarformuläret av Mötesbokare+
eller Admin Besiktare. Arbetstiden är **ramen**: schemat visar bara
halvtimmarna inom den, och bara tider inom den går att lägga in och boka.
En tid som lagts in tidigare och hamnar utanför en ny arbetstid finns kvar
i databasen men syns inte och går inte att boka.

## En dag är tom tills någon fyller den

Arbetstiden skapar inga tider av sig själv. En besiktare går att boka på
de tider som *lagts in*: av honom själv, av Admin Besiktare eller av
Mötesbokare+. Mallen fyller en dag med ett tryck.

## Schemat i appen (Bokningar → Besiktarnas tider / Mina tider)

- **Månaden**: ‹ månad ›, en ruta per dag med antal bokningsbara tider,
  en prick per möte och en röd ring där något är blockerat.
- **Dagen**: halvtimmarna inom arbetstiden, var och en *Ledig*, *Möte*,
  *Blockerad* (med orsak), *Ej bokbar* (inlagd men för nära ett möte eller
  dagen full) eller tom.
- **Lägg till tider** (läge): ett tryck lägger till en tom tid eller tar
  bort en inlagd. Ett tryck på en blockerad tid släpper blockeringen och
  lägger in tiden.
- **Blockera tider** (läge): ett tryck blockerar, med en valfri orsak; ett
  tryck på en blockerad släpper den. **Blockera för alla besiktare** finns
  för den som styr allas tider.
- **Lägg in Karls standardtider**: besiktarens mall, eller — utan egen
  mall — varje halvtimme inom arbetstiden. Blockerade och bokade tider hoppas
  över.
- **Töm dagen**, **Spara dagens tider som mall**.

Varje tryck skickas för sig (`saljartid-andra`), i den ordning de gjordes,
så två personer som ändrar samma dag inte skriver över varandra. En tid
med ett möte kan inte tas bort eller blockeras förrän mötet flyttats.

Besiktaren ser bara sitt eget schema. Väljaren listar bara besiktare.
