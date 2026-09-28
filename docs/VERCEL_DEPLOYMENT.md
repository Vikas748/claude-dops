# DOPS Manual Deployment: GitHub + Supabase + Vercel

Use this guide after extracting the final DOPS ZIP. Never paste passwords, SMTP credentials, `AUTH_SECRET` or service keys into source files or commit them to GitHub.

## 1. Push the source to GitHub

1. Create a **private** GitHub repository, for example `dops-surgery-management`.
2. Extract the ZIP and open that folder in VS Code.
3. Confirm that no `.env.local` or `.env.*` file (other than `.env.example`) is present.
4. Run:

```bash
git init
git add .
git commit -m "DOPS release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dops-surgery-management.git
git push -u origin main
```

## 2. Create the Supabase project (database and file storage only)

1. Open `https://supabase.com/dashboard` and create a project named `dops-surgery`. Choose the **Mumbai (ap-south-1)** region and save the database password securely.
2. When the project is ready, open **SQL Editor** and run these files, in order, each once:
   1. `supabase/schema.sql`
   2. `supabase/migrations/001_email_otp_auth.sql`
   3. `supabase/migrations/002_direct_uploads.sql`
   4. `supabase/migrations/003_search_indexes.sql`
   5. `supabase/migrations/004_job_runs.sql`

   All are safe to run again if you are unsure whether they ran.
3. Open **Storage** and confirm that the private bucket `dops-private` exists (the first script creates it).

DOPS does **not** use Supabase Authentication. No settings under Authentication (providers, email templates, redirect URLs, SMTP) need to be changed.

## 3. Prepare the sign-in email account (SMTP)

DOPS emails a 6-digit sign-in code through an ordinary SMTP account.

**For testing — Gmail (about 500 emails per day):**

1. Use a department-owned Gmail account, not a personal one.
2. Google Account → **Security** → turn on **2-Step Verification**.
3. Google Account → search **App passwords** → create one named `DOPS`. Copy the 16-character password.
4. Values: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=` the Gmail address, `SMTP_PASS=` the app password.

**Before clinical rollout — a transactional provider (recommended), e.g. Brevo:**
`SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, and the SMTP login and key from the Brevo dashboard. Only these variables change; no code changes.

Port 25 does not work on Vercel. Use 465 or 587.

## 4. Collect the required values

From Supabase **Project Settings**:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- Service-role key → `SUPABASE_SERVICE_ROLE_KEY`
- **Connect → Transaction pooler** connection string (port 6543) → `SUPABASE_DATABASE_URL`. Replace `[YOUR-PASSWORD]` with the database password.

Generate `DATA_ENCRYPTION_KEY` (it encrypts Aadhaar and bank account numbers in the Leprosy register):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Keep an offline copy of this key (for example printed and kept with the department's records).** The database and recovery backups hold these numbers only in encrypted form; without this exact key they cannot be read back. Never change it once real data exists.

Generate `AUTH_SECRET` on your computer (any machine with Node.js):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 5. Import into Vercel

1. Open `https://vercel.com/new`, import the private GitHub repository. The framework is detected as **Next.js**; keep the root directory as is.
2. Add these Environment Variables for **Production** and **Preview**:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DATABASE_URL
SUPABASE_STORAGE_BUCKET=dops-private
DOPS_BOOTSTRAP_ADMIN_EMAIL=the-first-admin@email
AUTH_SECRET
DATA_ENCRYPTION_KEY         (see step 4 — keep an offline copy)
CRON_SECRET                 (random, at least 16 characters — protects the scheduled jobs)
REPORT_EMAILS               (optional: comma-separated; default is every active Admin)
HEALTH_CHECK_TOKEN          (optional, see step 6)
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
MAIL_FROM=DOPS <the-smtp-email-address>
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is no longer used and can be removed from an existing Vercel project.

**Variable type:** add `NEXT_PUBLIC_SUPABASE_URL` as type **Config** (not Secret). Vercel does not allow `NEXT_PUBLIC_` variables to be Secret; saved as Secret, the value does not reach the build and file storage fails with `Storage upload signing failed (404)` in `/api/health`. The project URL is not a secret. Every other variable should be **Secret**. After changing a `NEXT_PUBLIC_` variable, **Redeploy**: its value is built into the app.

3. Click **Deploy**. After changing any variable later, use **Deployments → Redeploy** so the change takes effect.

## 6. Check the deployment

Open `https://YOUR-VERCEL-DOMAIN/api/health`. Every check should show `"ok": true`:

| Check | If it fails |
|---|---|
| `settings` | The `detail` lists missing variables — add them in Vercel and redeploy |
| `database` | `SUPABASE_DATABASE_URL` is wrong (use the transaction pooler string, port 6543, with the real password) |
| `migrations` | The `detail` names the SQL file(s) not yet run in the Supabase SQL Editor |
| `storage` | `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is wrong, or the `dops-private` bucket is missing |

For the full test — a real SMTP login plus a real file upload, verify, download and delete in storage — set `HEALTH_CHECK_TOKEN` to a random value of at least 16 characters and open:

`https://YOUR-VERCEL-DOMAIN/api/health?deep=1&token=YOUR_TOKEN`

This works even before anyone can sign in. A signed-in Admin can also use `/api/health?deep=1` without the token. Error details (for example the exact SMTP error) are shown only in this deep mode.

## 7. Create the first administrator

1. Open the deployed Vercel URL. You are sent to the sign-in page.
2. Enter the exact email set in `DOPS_BOOTSTRAP_ADMIN_EMAIL` and select **Send code**.
3. Type the 6-digit code from the email (check spam on the first try).
4. Because no active administrator exists yet, this account becomes the first DOPS Admin. The bootstrap email stops working as a shortcut once an active admin exists.
5. Open **Admin → Users** and add every other staff member's email with status `ACTIVE`, the right role and the minimum permissions. Only added, active users can receive a sign-in code.

## 8. If sign-in emails do not arrive

First open `/api/health?deep=1&token=YOUR_TOKEN` — the `email` check shows the exact SMTP error. Otherwise open Vercel → the project → **Logs**, and request a code again.

| What the sign-in page says | Likely cause |
|---|---|
| "Email service is not configured" | One of `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` is missing — add it and redeploy |
| "The sign-in code could not be emailed" | Wrong SMTP password / app password, or the provider blocked the login; the log shows the SMTP error |
| Success message, but no email | The email is not an `ACTIVE` user (by design, no email is sent), or it went to spam |
| "Sign-in is temporarily unavailable" | Database connection problem, or `AUTH_SECRET` missing/shorter than 32 characters |

## 9. Scheduled emails

`vercel.json` registers two jobs, which Vercel calls automatically. They only run when `CRON_SECRET` is set (without it every call is refused), and `/api/health` reports a missing `CRON_SECRET`:

| Job | When (IST) | What it does |
|---|---|---|
| Monthly reports | 1st of every month, around 06:00 | Emails last month's OPD and OT registers as PDF attachments to `REPORT_EMAILS`, or to every active Admin if that is empty |
| Daily | Every day, around 18:00 | Emails tomorrow's OT list (PAC-pending cases highlighted) to all active users with OT access, sent as BCC; then deletes abandoned uploads and expired sign-in records |

On Vercel's free Hobby plan a job may start at any time within its hour. Each job runs once per month/day even if Vercel calls it twice. To resend a month by hand, sign in as Admin and open `/api/cron/monthly-reports?month=2026-09&force=1`. Every run is recorded in the audit log (`REPORT_EMAIL`, `OT_REMINDER`). These emails contain patient names: send them only to department addresses.

## 10. How file uploads work

PDFs, OT images, discharge cards and backup packages go **directly from the browser to the private Supabase bucket** through short-lived signed links; they never pass through Vercel, so Vercel's 4.5 MB request limit does not apply. The server then checks each file's real type and size before attaching it. Limits: PDF 15 MB, OT image 8 MB, discharge card 10 MB; the bucket itself rejects anything over 50 MB. Files are opened through links that expire after 2 minutes. Uploaded-but-never-saved files are deleted after a day, and full-data backup/restore packages after an hour.

## 11. Restore existing data, if required

1. On the old deployment, download a recovery package from **Admin → System Recovery**.
2. On the new deployment, sign in as the admin, open **Admin → System Recovery** and restore it. Your admin email must exist as an `ACTIVE` admin inside the package.
3. After a restore, every other user must sign in again.
4. The new deployment must use the **same `DATA_ENCRYPTION_KEY`** as the old one, or restored Aadhaar/bank numbers show as `[unreadable]`.
5. Verify one patient timeline, one OT image/PDF, one report and the audit log.

Use dummy data for the first restore test.

## 12. Final acceptance checks (with dummy patients)

1. `/api/health?deep=1&token=…` is fully green.
2. Email code sign-in, wrong-code message, resend timer, and sign-out.
3. Admin adds a user; that user signs in; deactivating them signs them out.
4. Role restrictions per module.
5. OPD registration → IPD admission → Ward → OT → Discharge.
6. Discharge card and pre-op/post-op image upload/open/delete, including a phone photo larger than 5 MB.
7. Class, Research and Publication PDF upload.
8. Skin Bank, Leprosy and CM Helpline registers.
9. OPD/OT reports and Excel/CSV downloads.
10. Mobile layout and global patient search.
11. Recovery-package download, and a test restore of it.
12. Monthly report resend (`/api/cron/monthly-reports?month=…&force=1`) arrives with both PDFs; the Hindi names print correctly.

Only after these checks pass should real patient data be entered.

## 13. Updating the application later

Push changes to the GitHub `main` branch; Vercel builds and deploys automatically. If a deployment fails, promote the previous successful deployment from the Vercel dashboard. If a release includes a new file in `supabase/migrations/`, run it in the Supabase SQL Editor **before** deploying that release.
