#!/usr/bin/env bash
#
# Sätter upp fältsystemets server i ett svep: databas, tabeller, publicering
# och första administratören. Kör efter "npx wrangler login".
#
#   ./satt-upp.sh "Emil" emil@autoads.se
#
# Skriptet går att köra om — befintlig databas återanvänds och redan
# skapade konton lämnas orörda.

set -euo pipefail
cd "$(dirname "$0")"

NAMN="${1:-}"
EPOST="${2:-}"

if [ -z "$NAMN" ] || [ -z "$EPOST" ]; then
  echo "Användning: ./satt-upp.sh \"Ditt namn\" din@epost.se" >&2
  exit 1
fi

kor() { npx --yes wrangler@4 "$@"; }

hamta_id() {
  kor d1 list --json 2>/dev/null | node -e "
    let s = '';
    process.stdin.on('data', (d) => (s += d)).on('end', () => {
      const i = s.indexOf('[');
      if (i < 0) return console.log('');
      try {
        const lista = JSON.parse(s.slice(i));
        const db = lista.find((d) => d.name === 'autoads-falt');
        console.log(db ? (db.uuid || db.database_id || '') : '');
      } catch (e) { console.log(''); }
    });
  "
}

echo "→ 1/6  Letar efter databasen"
ID=$(hamta_id)
if [ -z "$ID" ]; then
  echo "→      Skapar databasen autoads-falt"
  kor d1 create autoads-falt >/dev/null
  ID=$(hamta_id)
fi
[ -n "$ID" ] || { echo "Kunde inte läsa ut database_id. Är du inloggad? Kör: npx wrangler login" >&2; exit 1; }
echo "→      Databas-id: $ID"

echo "→ 2/6  Skriver in id i wrangler.toml"
sed -i.bak "s/FYLL_I_DATABASE_ID_HAR/$ID/" wrangler.toml && rm -f wrangler.toml.bak

echo "→ 3/6  Skapar tabellerna"
kor d1 execute autoads-falt --remote --file=./schema.sql --yes

echo "→ 4/6  Publicerar workern"
UTDATA=$(kor deploy 2>&1) || { echo "$UTDATA" >&2; exit 1; }
URL=$(printf '%s' "$UTDATA" | grep -oE 'https://[a-z0-9._-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "$UTDATA" >&2; echo "Hittade ingen adress i deploy-utdatan." >&2; exit 1; }
echo "→      Adress: $URL"

echo "→ 5/6  Sätter installationsnyckeln"
NYCKEL=$(openssl rand -base64 24)
printf '%s' "$NYCKEL" | kor secret put INSTALL_NYCKEL >/dev/null

echo "→ 6/6  Skapar administratören $EPOST"
printf 'Välj ett lösenord (minst 8 tecken): '
read -rs LOSENORD
echo
[ "${#LOSENORD}" -ge 8 ] || { echo "Lösenordet är för kort." >&2; exit 1; }

KROPP=$(NYCKEL="$NYCKEL" NAMN="$NAMN" EPOST="$EPOST" LOSENORD="$LOSENORD" node -e '
  console.log(JSON.stringify({
    nyckel: process.env.NYCKEL,
    namn: process.env.NAMN,
    epost: process.env.EPOST,
    losenord: process.env.LOSENORD,
  }));
')

KOD=$(curl -s -o /tmp/falt-svar.json -w '%{http_code}' -X POST "$URL/api/installera" \
  -H 'Content-Type: application/json' -d "$KROPP")

case "$KOD" in
  200) echo "→      Administratören är skapad." ;;
  409) echo "→      Systemet var redan installerat — befintliga konton är orörda." ;;
  *)   echo "Misslyckades ($KOD):" >&2; cat /tmp/falt-svar.json >&2; rm -f /tmp/falt-svar.json; exit 1 ;;
esac
rm -f /tmp/falt-svar.json

cat <<KLART

  Klart.

  Serveradress:  $URL

  1. Öppna https://autoads.se/falt/ i mobilen
  2. Klistra in serveradressen ovan
  3. Logga in med $EPOST
  4. Lägg till appen på hemskärmen

  Övriga säljare läggs upp i appen under Admin → Användare.

KLART
