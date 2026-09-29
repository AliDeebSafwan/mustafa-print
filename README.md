# Mustafa Print ERP

Print-shop management system: a customer website, an **offline-first** staff PWA, a Node/Express API and PostgreSQL.
Built to run on a single small VPS (budget: 30 USD/month), one branch today, many branches later.

| Part | Path | Stack |
| --- | --- | --- |
| Customer website (SEO, Arabic/English, order tracking) | `apps/web` | Next.js 16 (App Router), Tailwind 4 |
| Staff app (offline PWA: customers, orders, payments, labels, barcode scan, inventory) | `apps/admin` | Vite + React, Dexie (IndexedDB), Workbox |
| API + messaging worker | `apps/api` | Node 22, Express 5, PostgreSQL, Drizzle |
| Shared rules (status machine, RBAC, money arithmetic, phone numbers, sync contract) | `packages/shared` | TypeScript |
| End-to-end tests: the real staff-app code against the real API and PostgreSQL | `e2e` | Vitest |
| Database migrations, schema tests | `apps/api/db` | plain SQL (source of truth) |
| Plans, guides, reports, database design | `docs/` (start at `docs/README.md`) | Markdown, PDF |

## Where things are

```
mustafa-print-erp/
├── apps/
│   ├── web/           customer website
│   │   └── src/components/   layout/ (page chrome) · ui/ (small pieces) · one folder per flow (cart, checkout, …)
│   ├── admin/         staff app (works offline)
│   │   └── src/pages/        one folder per area: orders, customers, companies, catalogue, reports, site, team
│   └── api/           API and background worker; database migrations in api/db/
│       ├── src/modules/      the work itself, one folder per area (orders, payments, messaging, …)
│       └── src/routes/       thin HTTP layer: admin/ · public/ · and, at its root, the routes that serve both
│                             (quotes, proofs) plus auth, sync, health and the WhatsApp webhook
├── packages/shared/   rules all three share
│   └── src/           rules/ (statuses, money, permissions) · contracts/ (sync payloads, API shapes) · util/
│                      index.ts and client.ts stay at the root: they are what the apps import
├── e2e/               end-to-end tests (the staff app's code against the real API)
├── deploy/            production server: Docker, Caddy, backups, restore
├── docs/              plans, guides, reports (index: docs/README.md)
└── .github/           automatic checks on every change
```

The files at the top level stay there because the tools look for them exactly there: `package.json`, `pnpm-workspace.yaml` and
`pnpm-lock.yaml` (the package manager), `docker-compose.yml` (the local database), `.env.example` (copy it to `.env`), `.nvmrc`
(the Node version), `.gitignore` and `.dockerignore`.

A folder is split only when unrelated things sit in it. `apps/admin/src/content` (one `*-api.ts` per server area),
`apps/admin/src/offline` (the sync engine) and `apps/web/src/lib` each do one job under a consistent naming
convention, so they stay flat — subdividing them would add depth without making anything easier to find.

## Quick start

Requirements: Node 22+, pnpm 10+, Docker.

```bash
pnpm install

cp .env.example .env                       # docker compose: set POSTGRES_PASSWORD
cp apps/api/.env.example apps/api/.env     # set DATABASE_URL (same password), JWT_ACCESS_SECRET (openssl rand -base64 48), SEED_ADMIN_PASSWORD (12+ chars)
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local

pnpm db:up                                 # PostgreSQL 16
pnpm db:migrate                            # applies db/migrations/*.sql (checksummed, idempotent)
pnpm db:seed                               # 5 roles, main branch, first admin (SEED_ADMIN_EMAIL / _PASSWORD), 36 default message templates

pnpm dev           # all four below at once, with labelled output

pnpm dev:api        # http://localhost:4000   (GET /health)
pnpm dev:worker     # sends queued notifications (console provider by default: prints instead of sending)
pnpm dev:web        # http://localhost:3000   (redirects to /ar or /en)
pnpm dev:admin      # http://localhost:5173   (staff PWA: sign in with the seeded admin)
```

Try it: create an order in the database (or the admin's "Add a test order" button in dev), then open
`http://localhost:3000/ar/track/<public_code>`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | all packages |
| `TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm test` | also runs the PostgreSQL integration tests and the end-to-end shop-day scenarios (`e2e`). Each test file creates and drops its own fresh, migrated database, so the role needs `CREATEDB` |
| `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/tests/smoke.sql` | schema rule tests (rolls back) |
| `pnpm db:erd` | regenerates `docs/database/erd.mermaid` and `docs/database/DATA-DICTIONARY.md` from the live schema |
| `pnpm --filter @mpe/api db:pull` | regenerates the typed Drizzle schema after a migration (copy `schema.ts` to `src/db/`) |
| `pnpm --filter @mpe/api wa:templates` | prints the WhatsApp templates to submit for approval in Meta Business Manager |

## Rules of the road

- **Migrations are append-only.** Never edit an applied file (the runner refuses); add the next numbered file.
- **Statuses, permissions and the sync contract (including every offline mutation payload) live in `packages/shared`.** The API validates with the same schemas the staff app is typed against.
- **Money is `numeric` in the database and a decimal string in JSON.** Never use floats for prices. The staff app previews totals with `packages/shared/src/money.ts`; `apps/api/tests/money-contract.integration.test.ts` checks it against PostgreSQL on hundreds of random orders, so a cashier never sees a different total from the one stored.
- **The staff app never queues what the server is certain to reject.** Every offline payload is validated against the shared schema before it is saved (`newMutation`).
- Customers are never messaged without recorded consent (`whatsapp_opt_in` etc. default to `false`).

## Hosting plan (single VPS, within the 30 USD budget)

```
Cloudflare (DNS, DDoS, CDN, TLS)
  └─ VPS, 4 GB RAM recommended
       ├─ Caddy (TLS to origin, reverse proxy)
       │    ├─ /api, /webhooks  → api      (Express)
       │    ├─ /                → web      (Next.js standalone)
       │    └─ admin.<domain>   → apps/admin/dist (static files)
       ├─ api  +  worker (same image, different command)
       └─ PostgreSQL 16 (named volume, port not published)
  └─ nightly pg_dump → encrypted → Backblaze B2 / S3, with a monthly restore drill
```

**To run it on a server, follow `deploy/README.md` (Arabic, step by step): Docker images, Caddy with automatic HTTPS, nightly encrypted backups with a weekly proven restore.**

Website content settings: `MEDIA_DIR` (uploaded pictures; **back it up with the database**), `PUBLIC_BRANCH_CODE` (the branch
the website shows, `MAIN`), and `WEB_REVALIDATE_URL` + `WEB_REVALIDATE_SECRET` on the API with the same secret as `REVALIDATE_SECRET`
on the website, so the owner's edits appear on the next visit. The website also needs `PUBLIC_API_URL` (where browsers load pictures)
and `SITE_URL`. The website is built without the API; **after each deployment, warm it** with
`curl -X POST https://<site>/api/revalidate -H "Authorization: Bearer $REVALIDATE_SECRET"`, or the first visitors see empty pages for up to a minute.

Auth settings for production: `NODE_ENV=production` (turns on `Secure` cookies), `CORS_ORIGINS=https://admin.<domain>`,
`VITE_API_URL=https://<domain>` when building the staff app, and keep the admin and the API on the **same registrable domain**
(the refresh cookie is `SameSite=Strict`). Behind Caddy set `TRUST_PROXY=1` so login rate limiting sees each visitor's real IP instead of the proxy's.

Do **not** host the website on Vercel's free Hobby plan: it is restricted to non-commercial use, and a shop that takes orders
is commercial. Cloudflare Pages (static) and a VPS both work. Check current provider prices before choosing a plan.

## Status

Built and tested (627 automated tests, run against a real PostgreSQL): the staff app, the API and its background worker, offline
sync, the customer website (redesigned, with measured speed and accessibility), invoices, company accounts, quotes, proofs,
reports, CSV import, the owner's daily email, and optional virus scanning of uploads.

Waiting on outside parties: WhatsApp (Meta approval), SMS and email from your own domain, Whish Pay (its documentation), and the
production server and domain. The deployment files are ready but have not yet run on a real server.

The full plan, the decisions still needed and what is left: `docs/ROADMAP.md` (Arabic).
