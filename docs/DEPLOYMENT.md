# Deployment

The app is a standard Next.js server application with a PostgreSQL database. These steps use Vercel and a managed
PostgreSQL (Neon, Supabase, RDS…), but any Node.js host works.

## 1. Database

Create a PostgreSQL 15+ database and a connection string with TLS. Migrations (`db/migrations/*.sql`) create the
tables, the restricted `cno_app` role and the row-level security policies. They run automatically on first connection;
for controlled releases set `DB_AUTO_MIGRATE=false` and run:

```bash
DATABASE_URL=postgres://… npm run db:migrate
DATABASE_URL=postgres://… npm run db:seed
```

The migration creates the `cno_app` role (NOLOGIN) and grants it to the connecting user, so private-data queries can
`set local role cno_app`; row-level security then applies to them whatever role the server connected as. If your
provider doesn't allow creating roles, create `cno_app` as an administrator first. For least privilege, connect with a
dedicated database owner role rather than a superuser.

PGlite (the default without `DATABASE_URL`) is for development and single-instance demos only.

## 2. Environment

Set these in the host's encrypted environment settings (never in the repository). See `.env.example`.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | TLS by default; `DATABASE_SSL=no-verify` only if your provider requires it |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes; rotating it signs everyone out |
| `BETTER_AUTH_URL` | yes | The public origin, e.g. `https://nutrition.example.edu` |
| `SMTP_URL`, `MAIL_FROM` | yes | Without SMTP, verification and reset emails are not delivered |
| `ADMIN_EMAILS` | for `/admin` | Verified accounts only |
| `CRON_SECRET` | for scheduled sync | 16+ characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` |
| `ENABLE_DEMO_UNIVERSITY` | optional | Off in production unless set to `true` |
| `NUTRISLICE_SYNC_ENABLED` | for UW–Madison menus | Unofficial sync without an agreement with Nutrislice; read [MENU_DATA_INTEGRATION.md](MENU_DATA_INTEGRATION.md) first |
| `NUTRISLICE_SYNC_AUTHORIZED`, `NUTRISLICE_AUTHORIZATION_REF` | only with written authorization | Authorized feed; takes precedence |

## 3. Build and deploy

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build
npm start          # or deploy to Vercel, which runs the build for you
```

`next.config.ts` bundles the USDA index and the SQL migrations with the server (`outputFileTracingIncludes`) and keeps
the WebAssembly packages (PGlite, HiGHS) external.

## 4. Scheduled jobs

`vercel.json` runs `GET /api/cron/sync` daily at 09:15 UTC (early morning in Madison). Vercel sends
`Authorization: Bearer $CRON_SECRET`; other hosts can call it with any scheduler:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/sync
```

The job syncs universities whose provider allows automatic retrieval (UW–Madison when the Nutrislice sync is on), re-estimates
foods made by an older estimator, and prunes expired rate-limit records.

## 5. Security checklist

- Secrets only in server environment variables; no `NEXT_PUBLIC_` secrets exist in this app.
- Every private table (profiles, diary, favorites, saved meals, plans) is read and written through `withUser`, which
  switches to `cno_app` with `app.user_id` set, so row-level security limits each statement to the signed-in user.
- Server actions validate input with Zod and are rate limited per user or hashed client address; raw IP addresses are
  never stored.
- Menu imports go through an admin-only route handler with same-origin checks and a 5 MB cap; all other server actions
  keep Next.js's 1 MB default.
- Security headers (`nosniff`, `DENY` framing, strict referrer, restricted permissions) are set in `next.config.ts`.
  Add a Content-Security-Policy suited to your host if you need one.
- Account deletion removes the user and cascades to all of their data; data export is at Settings → Your data.
- Back up the database. University requests may include optional contact emails; delete them once handled.

## 6. After deploying

- Sign up with an address listed in `ADMIN_EMAILS`, verify it, and open `/admin`.
- Check `/universities`: with the sync on, UW–Madison shows "Synced from public menus"; start a first sync from
  `/admin` rather than waiting for the nightly job. With it off, it shows "Menu sync off" until menu files are imported.
- Re-check dining hours in `src/lib/universities/catalog.ts` each term.
