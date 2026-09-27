# Version

| | |
|---|---|
| Appens version | **2026-09-27.1** (`VERSION` i `falt/config.js`, visas på inloggningsskärmen) |
| Service worker-cache | `falt-v35` (`CACHE` i `falt/sw.js`) |
| Server | `worker-falt/src/index.js`, samma commit som appen |
| Databasschema | `worker-falt/schema.sql` + stegen i `.github/workflows/satt-upp-faltsystemet.yml` |
| Gren | `claude/door-knock-sales-app-1oegem` (2026-09-23.1 är utrullad från den; `main` ligger efter) |
| Tester | 127, alla gröna |

Versionen höjs när något i `falt/` ändras: `VERSION` får dagens datum och
ett löpnummer, `CACHE` ett steg upp — annars får telefonerna inte den nya
appen. Vad som ändrats står i [CHANGELOG.md](CHANGELOG.md), hur systemet
fungerar i [APP_SYSTEM_BACKUP/](APP_SYSTEM_BACKUP/00_README.md).
