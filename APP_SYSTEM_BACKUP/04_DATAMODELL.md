# 04 — Datamodell

Källan är `worker-falt/schema.sql`. Den körs vid varje utrullning och
skapar det som saknas (`CREATE TABLE IF NOT EXISTS`). Kolumner som
tillkommit efteråt läggs på gamla databaser av utrullningens steg
*Uppdatera gamla tabeller* — se [16_MIGRERINGAR.md](16_MIGRERINGAR.md).
Tider i `skapad`, `senast_tid` m.fl. är millisekunder sedan 1970 (UTC).
Datum är `ÅÅÅÅ-MM-DD`, klockslag `HH:MM`, båda svensk tid.

## Konton

**anvandare** — id, namn, epost (unik), roll, team, `max_per_dag` (tak för
möten per dag, standard 3), `snabbtider` (besiktarens mall, "10:00,13:00"),
`arbetstid_fran`/`arbetstid_till` (NULL = 09:00/18:00), `nyheter_sedda` och
`nyheter_rensade` (ms, per användare), hash, salt (PBKDF2), aktiv, skapad.

**sessioner** — token, anvandare_id, giltig_till (30 dagar).

## Dörrar

**omraden**, **omrade_saljare** — områden och vilka mötesbokare som har dem.
Ett område utan tilldelning är synligt för alla.

**adresser** — en dörr. gata, nummer (skrivs som på huset: 12A), postnummer,
postort, `kommun`, `nyckel` (normaliserad och unik: gata|nummer|ort utan
mellanslag och skiljetecken), lat, lon, `status` (ejbesokt | bokat | ejsvar |
nej), senast_tid/_av/_resultat, sparrad_till, antal_besok, broschyr*, `dold`
och `dold_av` (raderad från kartan men med historik kvar).

**handelser** — varje besök, raderas aldrig. resultat (bokat | ejsvar | nej;
gamla rader kan ha aterkom), orsak, oppnade, positiv, kommentar, lat, lon,
skapad (tiden besöket gjordes, även ur kön), `klient_id` (telefonens id för
registreringen, unikt — samma registrering sparas en gång).

## Bokningar

**bokningar** — adress_id, handelse_id, anvandare_id (mötesbokaren),
`saljare_id` (besiktaren), fornamn, efternamn, telefon, `lagenhet`, datum,
tid, stege, kommentar, `status` (bokad | genomford | ej_genomford |
avbokad), skapad (när bokningen gjordes), `andrad`, `andrad_av`.
Unikt index `idx_bok_saljarslot` på (datum, tid, saljare_id) för bokningar
som inte är avbokade — sista skyddet mot dubbelbokning.

**aterkoppling** — omdömen, en rad per omdöme; den senaste gäller.
utfall (salt | ej_salt | uppfoljning | uteblev | ej_genomford), belopp,
text (anteckningar), `genomford` (1/0), `orsak` (ingen_hemma | avbokade |
ombokad | annat), `intresserad`, `blev_jobb`, `vad_hande`.

**kommentarer**, **bilagor** — på en bokning. Bilderna skalas ner i telefonen
och sparas som data-URL (max ca 900 kB, 20 per bokning).

## Scheman och orter

**saljartider** — en rad per tid: saljare_id, datum, tid, `ledig` (1 inlagd,
0 blockerad), `orsak` (varför blockerad), satt_av. Unik på (saljare_id, datum, tid).

**platser** — orter besiktarna jobbar i: namn (unikt), kommun, lat, lon,
radie_km. Sala, Västerås, Köping, Örebro och Stockholm finns från början.

**besiktare_platser** — vilka orter varje besiktare jobbar i.

## Övrigt

**nyheter**, **nyhet_dold** — flödet, och vad var och en svept bort.
**andringar** — en rad; `senast` stämplas vid varje ändring (realtid).
**positioner** — mötesbokarnas senaste position.
**installningar** — spärrtider, mål, hit rate-definition.
