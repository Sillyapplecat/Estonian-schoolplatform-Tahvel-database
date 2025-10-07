# tahvel-data-seeder
**Purpose:** Reproducible seed for the `tahvel` MariaDB database (education platform) to generate large realistic data sets (>= 2,000,000 rows in large tables) using Bun.  
This repo contains `dump.sql` (your schema), a Bun seed script (`seed.ts`), Docker Compose to run MariaDB + phpMyAdmin + Bun, and instructions.

## What is produced
By default the seed script will generate large CSVs and bulk-load them into MariaDB using `LOAD DATA LOCAL INFILE`.  
Default targets (configurable via `.env`):
- `users`: **2,000,000** rows (students + teachers + admin)
- `submissions`: **2,000,000** rows
- `attendance`: **2,000,000** rows  
Other non-lookup tables are filled in proportionally to keep foreign keys valid (classes, class_memberships, lessons, assignments). All FK constraints are preserved.

> You can change counts in `.env` before running. The script is deterministic (fixed seed) so results are reproducible.

## Repo contents
- `dump.sql` — the schema (from you).
- `seed.ts` — Bun TypeScript seeder (generates CSVs and bulk-loads).
- `docker-compose.yml` — MariaDB, phpMyAdmin, and bun worker service (alpine).
- `.env.example` — environment variables and defaults.
- `README.md` — this file.

## Prerequisites
- Docker & Docker Compose (tested on Linux, Alpine host in your case).
- `bun` will be installed automatically inside the Bun service container; you don't need Bun locally.
- The MariaDB image version in docker-compose is `mariadb:11.4` (matches dump header). Adjust if you prefer another.
- Host expects volumes to be writable: `./data` for CSVs and DB persisted data.

## Quickstart (from project root)
1. Copy `.env.example` to `.env` and edit if desired:
```bash
cp .env.example .env
```
2. Load the schema into the DB (the compose file helps but the fastest is to run the mariadb container and import `dump.sql`):
```bash
# start MariaDB only (no bun worker yet)
docker compose up -d mariadb

# wait for DB to be ready, then:
docker cp dump.sql $(docker compose ps -q mariadb):/dump.sql
docker exec -it $(docker compose ps -q mariadb) sh -c "mysql -uroot -p\"$MYSQL_ROOT_PASSWORD\" < /dump.sql"
```

3. Start full stack (mariadb, phpmyadmin, bun worker):
```bash
docker compose up -d
# watch logs for bun worker:
docker compose logs -f bun
```

4. The bun worker will generate CSVs into `./data/csv/` then `LOAD DATA` into MariaDB in batches. Progress is printed to logs.

## Design & strategy summary
- **Lookup vs non-lookup**: small lookup tables: `schools`, `subjects`. Non-lookup (large) tables: `users`, `class_memberships`, `lessons`, `assignments`, `submissions`, `attendance`, `grades` (some may be large). We mark `schools` and `subjects` as lookups and create small realistic sets.
- **Order of loading**: create lookup tables → users (teachers + students) → schools/classes → classes → lessons → assignments → submissions → grades → attendance. This ensures FK integrity.
- **Realistic data**: uses locale-aware (Estonian-like) names, emails formed from names with domain list, addresses (city list), dates distributed over recent 3 years, times for lessons during school hours, grades sampled from allowed enums. All deterministic with fixed seed.
- **Batching & bulk load**: the script writes CSV files in configurable batch sizes (default 50k rows per file) and uses `LOAD DATA LOCAL INFILE` inside transactions to maximize throughput. Indexes are present but the script temporarily drops non-essential indexes where safe (instructions included) — however, because the schema contains FK constraints, we keep primary keys and rely on fast `LOAD DATA`.
- **Reproducibility**: fixed seed (`SEED=12345` by default). Script uses the seed to create deterministic pseudo-random values.

## Performance notes & expected runtime
Performance depends on host resources. On a modest dev machine (4 vCPUs, 8-16GB RAM), expect the full run to take 20–90 minutes. With strong machines it will be faster. The README contains recommended batch sizes and memory/disk considerations.

## Safety & integrity checks
- After loading, the script runs SQL checks to confirm FK counts equal expected counts (no orphaned FKs).
- Unique constraints (users.username, users.email, schools.name, subjects.name, unique pairs) are respected during generation.

## Running without Docker (optional)
If you already have MariaDB running, you can:
1. Install Bun locally (`curl -fsSL https://bun.sh/install | bash`) — not performed by this repo.
2. Set `.env` to point to your DB.
3. Run the script:
```bash
bun install
bun run seed.ts
```

## Files to edit before running
- `.env` – configure DB connection, counts, batch size, and seed.

## Troubleshooting
- If `LOAD DATA LOCAL INFILE` is disabled by server, enable it by adding `--local-infile=1` in my.cnf or using `docker exec` to start mysqld with that option. Instructions are in the README file in the repo.

--- End of README
