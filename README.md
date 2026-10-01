# DOPS — Department Operations & Patient System

DOPS is a private, mobile-responsive application for the Department of Burn & Plastic Surgery, NSCB Medical College Jabalpur. One patient identity flows through OPD, IPD, Ward, OT, discharge and CM Helpline, with academic and special-register modules.

## Production stack

- Next.js 16, React 19 and TypeScript
- Vercel hosting for the website and API routes
- Supabase PostgreSQL for clinical data
- Passwordless 6-digit email OTP (Nodemailer SMTP) with database sessions
- Private Supabase Storage for PDFs, discharge cards and OT images

## Main modules

- Dashboard and global patient search
- OPD registration, edit, soft delete and admission
- IPD, Ward, PAC, OT and discharge workflow
- Pre-op/post-op images and monthly reports
- Class, Research and Publication documents
- Skin Bank and Leprosy spreadsheet-style registers
- CM Helpline linked from existing OPD/IPD patients
- Admin users, module permissions, audit log, UAT and recovery

## Local setup

1. Copy `.env.example` to `.env.local` and enter your Supabase values.
2. In the Supabase SQL Editor run `supabase/schema.sql`, then every file in `supabase/migrations/` in order (001 → 008).
3. Install and verify:

```bash
pnpm install
pnpm test
pnpm lint
pnpm build
pnpm dev
```

End-to-end tests against a real PostgreSQL database: see [tests/e2e/README.md](tests/e2e/README.md).

## Deployment

Follow [Vercel deployment guide](docs/VERCEL_DEPLOYMENT.md). Never commit `.env.local`, database passwords, access tokens or service-role keys.

In short:

1. Supabase (Mumbai region): run `supabase/schema.sql` and `supabase/migrations/001…008`.
2. Vercel environment variables: `SUPABASE_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `DOPS_BOOTSTRAP_ADMIN_EMAIL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` (**keep an offline copy**), `CRON_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; optional `HEALTH_CHECK_TOKEN`, `REPORT_EMAILS`.
3. Deploy, then open `/api/health?deep=1&token=…` — every check must be green.
4. Sign in with the bootstrap admin email, set your name, add staff under **Admin → Users**.

## Documentation

- [Vercel deployment](docs/VERCEL_DEPLOYMENT.md)
- [Production handover](docs/PRODUCTION_HANDOVER.md)
- [Admin quick start](docs/ADMIN_QUICK_START.md)
- [API reference](docs/API_REFERENCE.md)
- [Mobile app API guide](docs/MOBILE_API.md)
- [Go-live checklist](docs/GO_LIVE_CHECKLIST.md)
