# tahvel-seed — mass-andmete seemendaja (Bun + MariaDB)

**Eesmärk:** täita `tahvel` andmebaasi realistlike andmetega nii, et vähemalt ühes mitte-lookup tabelis on ≥ 2 000 000 rida.

Failid:
- `dump.sql` — andmebaasi skeem (saadud phpMyAdmin dump). (Saadetud/üleslaetud faili kasutatakse.) :contentReference[oaicite:3]{index=3}
- `seed.ts` — Bun skript, mis genereerib ja täidab andmed.
- `.env.example` — näidis keskkonnamuutujatest.

## Nõuded (sinu keskkond)
- Sul on juba Docker + MariaDB + phpMyAdmin install (kuidas kirjeldasid).
- Node/Bun: vajadus bun v1.x (soovitatav Bun v1.8+).
- Skript kasutab `@faker-js/faker` ja `mysql2/promise` pakette (Bun install käsk).

## Install ja ettevalmistus
1. Kloneeri repo (või kopeeri failid) serverisse.
2. Kopeeri `.env.example` → `.env` ja pane õiged väärtused:
   ```bash
   cp .env.example .env
   # muuda .env vastavalt
