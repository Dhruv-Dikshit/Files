# Evenly: group expense splitting

Self-hosted group expense splitting, in the spirit of Splitwise and Splid. Create groups, add expenses with flexible splits, include or exclude people per expense, scan receipts, and settle up in the fewest payments. All data is stored in PostgreSQL on your own machine.

**→ Design doc: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (product analysis, data model, algorithm, UI plan)

## Run it on localhost (recommended: Docker)

You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) or Docker Engine (Linux).

```bash
cd evenly
docker compose up -d --build
```

Open **http://localhost:3000**, enter your name, and create your first group.

This starts three services:

| Service | What it does |
|---|---|
| `db` | PostgreSQL 17. Data is kept in the `evenly-db` Docker volume. |
| `migrate` | Creates or updates the database tables, then exits. Runs on every `up`. |
| `app` | The Evenly web server on port 3000. |

**Always on.** `db` and `app` use `restart: unless-stopped`, so they come back by themselves after a crash or a reboot, as long as Docker itself starts. In Docker Desktop, turn on **Settings → General → Start Docker Desktop when you sign in**. On Linux, run `sudo systemctl enable docker`. After that, Evenly is at `http://localhost:3000` whenever your computer is on.

**Everyday commands**

```bash
docker compose ps                     # is it running?
docker compose logs -f app            # live server logs
docker compose stop                   # stop (data kept)
docker compose up -d                  # start again
git pull && docker compose up -d --build   # update to a new version (data kept, migrations applied)
```

**Backups.** Your data lives in the `evenly-db` volume. `docker compose down` keeps it. **`docker compose down -v` deletes it.**

```bash
docker compose exec db pg_dump -U evenly evenly > evenly-backup-$(date +%F).sql   # back up
docker compose exec -T db psql -U evenly evenly < evenly-backup-2026-10-07.sql     # restore into an empty database
```

**Settings.** Create a `.env` file next to `docker-compose.yml` to override any of these:

| Variable | Default | Meaning |
|---|---|---|
| `EVENLY_PORT` | `3000` | Port on your computer |
| `TZ` | `Asia/Kolkata` | Time zone that decides "today" and when recurring expenses post |
| `POSTGRES_PASSWORD` | `evenly` | Database password. Set it **before** the first `up`; it is fixed once the volume exists |

**Using it from your phone or friends' devices.** The app listens on your local network. Find your computer's IP address (for example `192.168.1.20`) and open `http://192.168.1.20:3000` on any device on the same Wi-Fi. Invite links work the same way. To keep it to this computer only, change the app's port mapping to `"127.0.0.1:3000:3000"`.

> Sign-in is just a name remembered by your browser (no passwords). That's fine on your own computer or home network. **Don't expose it to the internet** without adding real authentication in front of it.

## Develop locally (without building the image)

```bash
cd evenly
npm install            # also generates the Prisma client
cp .env.example .env   # points at the Docker Postgres on localhost:5433
npm run setup          # starts only the db container and applies migrations
npm run dev            # http://localhost:3000 with hot reload
npm test               # unit tests (splits, simplification, currency, recurring, receipts, export)
npm run typecheck
npm run db:studio      # browse the database in Prisma Studio
```

If you'd rather use a Postgres you already have, point `DATABASE_URL` in `.env` at it and run `npm run db:migrate`.

## Features

| | |
|---|---|
| Groups | Create, invite by link or code, add placeholder people who can claim their spot later, deactivate or remove members |
| Expenses | Single or multiple payers, categories, dates, editing protected against two people overwriting each other, delete with restore |
| Include/exclude | Tap anyone in the split list to leave them out of that expense |
| Split types | Equally · Exact amounts · Percentages · Shares · Itemized (tax/tip shared proportionally) |
| Debt simplification | Provably minimal number of transfers for up to 15 people, greedy fallback above |
| Settlements | Mark paid (full or partial, with payment method), undo |
| Multi-currency | Live ECB exchange rates (Frankfurter, cached daily) or your own rate; balances shown in the group currency |
| Receipt OCR | Tesseract runs on your machine with no API key: photo → line items, taxes and total |
| Recurring | Weekly/monthly/yearly; if the computer was off, missed occurrences are posted on the next visit |
| Activity feed | Every change with before→after details |
| Export | CSV (per-member columns, balances, settle plan) and print-to-PDF |
| Sync | Open pages refresh when focused and every 20 seconds, so groupmates see each other's changes |

**Needs internet:** only live exchange rates. Without a connection, or for currencies the ECB doesn't publish (such as AED), you type the rate in. Everything else, including OCR, works offline.

## Design

The UI follows the **Split the Bill UI Kit** (Figma › 📌 Components & Styles):

- **Colours:** the kit's palette (Primary/Dark `#19191D`, Grey `#ADB0B9`, Accent `#996BFF`, Action `#F5DB54`, Snow/Hazy/Cloudy surfaces, Dark/002 and Dark/004 for dark mode). They are defined as theme tokens in `src/app/globals.css`, and dark mode follows your device setting. The one colour not in the kit is `danger` (`#F0616D`), used for amounts you owe and for delete actions.
- **Components:** Button M/S, the pill tab bar, List rows with the purple check radio, Order cards with gradient icon tiles, Counter, Tag, Chart column, gradient avatars and the navigation bar. They live in `src/components/ui/primitives.tsx`.
- **Icons:** exported unmodified from the kit into `public/icons/`.
- **Typeface:** e-Ukraine, the kit's font, is used when it's installed on your computer (it's free from the Diia brand book). Otherwise the bundled Onest font takes over, which has similar proportions.
- **Avatars:** the kit shows memoji faces inside its coloured avatar circles. Here the circles show people's initials instead.

## Project layout

```
docker-compose.yml, Dockerfile  Postgres + migration job + app server
prisma/schema.prisma            Data model; prisma/migrations/ holds the SQL
src/lib/domain/                 Pure TypeScript shared by browser and server
  money.ts                      minor-unit parsing/formatting, exact allocate()
  splits.ts                     computeSplit() for all five split types, validatePayers()
  simplify.ts                   simplifyDebts(): minimum transfers
  balances.ts                   computeBalances() with multi-currency
  currency.ts, recurring.ts, export.ts
  receipts.ts                   parseReceiptText(): OCR text → items/taxes/total
src/server/                     Server-only code
  actions.ts                    every mutation (validate → transaction + activity log)
  queries.ts                    page data loaders
  write.ts                      draft validation (re-runs split math) + row builders
  session.ts                    cookie-based profile
  recurring.ts, rates.ts, ocr.ts, mappers.ts, db.ts
src/components/expense/         Add Expense form (useExpenseForm + sections)
src/components/group/           Expense list, balances, activity feed, members
src/components/pages/           Client views for each screen
src/app/                        Routes: /, /welcome, /groups/[id], /groups/[id]/settle, /join/[code], /api/receipts/scan
```
