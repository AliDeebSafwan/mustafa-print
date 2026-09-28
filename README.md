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
| Design notes, ERD, data dictionary | `docs/` | Mermaid + Markdown |

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
| `pnpm db:erd` | regenerates `docs/erd.mermaid` and `docs/DATA-DICTIONARY.md` from the live schema |
| `pnpm --filter @mpe/api db:pull` | regenerates the typed Drizzle schema after a migration (copy `schema.ts` to `src/db/`) |
| `pnpm --filter @mpe/api wa:templates` | prints the WhatsApp templates to submit for approval in Meta Business Manager |

## Rules of the road

- **Migrations are append-only.** Never edit an applied file (the runner refuses); add `0010_...sql`.
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

Done and tested against real PostgreSQL 16: database schema (19 tables), migration runner, seed, messaging pipeline
(templates, consent, dedupe, outbox worker, retries, WhatsApp/Email providers, signed status webhook), public order tracking,
customer website (ar/en, RTL/LTR), **authentication** (argon2id, short access token + rotating refresh cookie with theft detection,
login throttling, role permissions enforced on every request), **offline sync endpoints** (`push` with idempotency, field-level conflict
detection and role/branch checks; `pull` with per-role scoping and safe paging), and the **staff app**: sign-in, new customer / new order
(catalogue or custom items, delivery, discounts, exact totals), order screen with payments and refunds, status changes limited to what
the user's role may do, printable QR label, order search, barcode scan. Everything above works offline and syncs when the connection returns.

Not verified in a real browser yet: the screens are covered by jsdom UI tests and the sync path by end-to-end tests, but layout and the
camera/print behaviour must be checked on your actual tablets and phones (the sandbox had no browser).

Next milestones, in order:
1. Staff screens still missing: courier assignment, conflict review (the queue exists, there is no screen), stock movements, customer
   editing; REST endpoints for dashboards/reports; automatic stock deduction from `product_materials`.
2. Artwork upload (`order_files` + object storage with signed URLs), invoices (HTML → PDF).
3. Whish Pay adapter (needs the merchant API documentation and credentials), SMS provider, production Docker/Caddy/backup files.
4. Initial data setup. The project starts from scratch (there is no old system to migrate): products, prices and opening stock are entered in the admin screens, with an optional CSV import (see `docs/DB-DESIGN.md` section 6).

The full plan to the end of the project (milestones, decisions needed from the owner, risks, definition of done) is in `docs/ROADMAP.md` (Arabic).
See `docs/DB-DESIGN.md` (Arabic) for the reasoning behind the schema and the offline-sync design.
