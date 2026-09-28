# DOPS API Reference

All endpoints except sign-in require a DOPS session: the `dops_session` httpOnly cookie (web) or an `Authorization: Bearer <token>` header (mobile app). Every protected operation also checks the DOPS account status and the relevant server-side permission. Mutation endpoints enforce origin, request-size and rate-limit controls where applicable.

Successful JSON responses generally use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "message": "..." }` with an appropriate HTTP status.

## Identity and administration

| Method | Route | Purpose | Access |
|---|---|---|---|
| POST | `/api/auth/request-otp` | Body `{ email }`. Emails a 6-digit code if the address is an `ACTIVE` user (neutral reply otherwise). 60 s resend cooldown; per-email and per-network hourly limits (HTTP 429 with `retryAfter`) | Public |
| POST | `/api/auth/verify-otp` | Body `{ email, code, client? }`. `client: "MOBILE"` returns `{ token, expiresAt }`; web receives the session cookie. 5 attempts per code | Public |
| GET/POST | `/api/auth/logout` | Ends the current session. GET redirects to `/login` (web); POST returns JSON (mobile) | Signed-in user |
| GET | `/api/health` | Deployment self-test. `?deep=1` adds SMTP login and a storage round trip (Admin session or `?token=HEALTH_CHECK_TOKEN`) | Public (quick) |
| POST | `/api/uploads` | Step 1 of every file upload. Body `{ purpose, fileName, contentType, size, ... }` with `purpose` `ACADEMIC` (+`kind`), `OT_IMAGE` (+`otId`, `imageType`) or `DISCHARGE_CARD` (+`wardId`). Checks the module permission, type and size; returns `{ uploadId, uploadUrl }`. The client then `PUT`s the file to `uploadUrl` (Supabase Storage) and passes `uploadId` to the module API below | Module CREATE/EDIT permission |
| GET | `/api/access` | Current user identity, role and navigation permissions | Active user |
| GET | `/api/admin` | Current account; Admin also receives users and recent audit logs | Active user; expanded for Admin |
| POST | `/api/admin` | Create or update a user, status, role and action permissions | Admin |
| GET | `/api/admin/system?action=...` | Recovery status or full backup package | Admin |
| PUT | `/api/admin/system` | Update approved system settings | Admin |
| POST | `/api/admin/system` | Run `backup` or controlled `restore` action | Admin |
| GET | `/api/admin/uat` | Load UAT results | Admin |
| POST | `/api/admin/uat` | Save a UAT check status and evidence note | Admin |

## Patients and OPD

| Method | Route | Purpose | Permission |
|---|---|---|---|
| GET | `/api/patients?q=...` | Search/list active patients and OPD data | `OPD:VIEW` |
| POST | `/api/patients` | Create patient and first OPD visit | `OPD:CREATE` |
| GET | `/api/patients/:id` | Complete linked patient timeline | `OPD:VIEW` plus module filtering |
| PATCH | `/api/patients/:id` | Update patient/OPD details | `OPD:EDIT` |
| DELETE | `/api/patients/:id` | Soft-delete patient/OPD record | `OPD:DELETE` |
| POST | `/api/opd/:id/admit` | Create a linked IPD admission from OPD | `IPD:CREATE` |

## IPD, Ward and OT

| Method | Route | Purpose | Permission |
|---|---|---|---|
| GET | `/api/clinical` | Load permitted IPD, Ward and OT lists | Any related `VIEW` permission |
| POST | `/api/clinical` | Run the clinical action selected by JSON `action` | Related action permission |
| POST | `/api/clinical` (multipart) | Upload Ward discharge card | `WARD:EDIT` |
| GET | `/api/alerts` | PAC and upcoming OT alerts | Active user with relevant visibility |

Supported clinical JSON actions include `update_ipd`, `move_ward`, `pac`, `schedule_ot` and `ot_status`; the server derives and checks the required IPD, Ward or OT permission for each action.

## OT images and files

| Method | Route | Purpose | Permission |
|---|---|---|---|
| GET | `/api/ot-images?otId=...` | List pre-op/post-op images for a procedure | `OT:VIEW` |
| POST | `/api/ot-images` | Upload a pre-op or post-op image | `OT:CREATE` |
| DELETE | `/api/ot-images?id=...` | Delete an OT image | `OT:DELETE` |
| GET | `/api/files?...` | Stream a protected stored document | Matching module `VIEW` |

Files are stored privately; database records retain storage keys and metadata rather than public URLs.

## Academic documents

Use `/api/academic?kind=CLASS|RESEARCH|PUBLICATION`.

| Method | Purpose | Permission |
|---|---|---|
| GET | Search/list documents by kind and filters | `<KIND>:VIEW` |
| POST | Upload or save the module document/link | `<KIND>:CREATE` |
| DELETE | Soft-delete a document record | `<KIND>:DELETE` |

## Special registers

Use `/api/special?kind=SKIN_RECIPIENT|SKIN_DONOR|LEPROSY|HELPLINE` with optional `q`, `from`, `to` and `format=csv|xls`.

| Method | Purpose | Permission |
|---|---|---|
| GET | List/search a register | Module `VIEW` |
| GET with `format` | Export a register | Module `EXPORT` |
| POST | Create/update a register row | Module `CREATE` or `EDIT` |
| POST with `action=link_helpline` | Link existing OPD/IPD patient to CM Helpline | `CM_HELPLINE:CREATE` |
| DELETE with `id` | Soft-delete a register row | Module `DELETE` |

Skin recipient/donor kinds map to `SKIN_BANK`; Helpline maps to `CM_HELPLINE`. Non-admin Leprosy responses mask Aadhaar and account-like fields.

## Reports

| Method | Route | Formats | Permission |
|---|---|---|---|
| GET | `/api/reports/opd?from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|csv` | PDF, CSV | `OPD:EXPORT` |
| GET | `/api/reports/ot?from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|csv` | PDF, CSV | `OT:EXPORT` |

## Operational notes

- Do not call these routes from an untrusted origin.
- Do not bypass the application by constructing write requests manually.
- Never place patient data or file contents in URL query parameters.
- API shapes are internal to DOPS and should be versioned before external integration.


## File uploads (changed in V1.1)

Files are no longer sent to the DOPS API. The module endpoints receive JSON with the `uploadId`(s) from `/api/uploads`, and verify the stored file (owner, purpose, expiry, real file signature, size) before attaching it:

| Method | Route | Body |
|---|---|---|
| POST | `/api/academic` | `{ kind, title, doctorName, documentDate, externalUrl?, uploadId }` |
| POST | `/api/ot-images` | `{ otId, imageType, uploadIds: [1–6] }` — all-or-nothing |
| POST | `/api/clinical` | `{ action: "discharge", wardId, notes, uploadId? }` |
| GET | `/api/files?key=` | Permission check, then `302` redirect to a 2-minute signed storage URL |
| POST | `/api/admin/system` | `{ action: "backup" }` → `{ url, exportedAt, fileCount }` (signed link to the database export); `{ action: "restoreFileUrl", key }` → `{ uploadUrl }`; `{ action: "restorePackageUrl", size }` → `{ uploadId, uploadUrl }`; `{ action: "restore", uploadId }` |
| GET | `/api/admin/system?file=` | `302` redirect to a signed URL for one stored file (backup ZIP building) |

## Reports and scheduled jobs

| Method | Route | Purpose | Access |
|---|---|---|---|
| GET | `/api/reports/{opd|ot}?from=&to=&format=pdf|csv` | Letterhead PDF (A4 landscape, page numbers, Hindi supported) or Excel-ready CSV. Period at most one year | `OPD:EXPORT` / `OT:EXPORT` |
| GET | `/api/special?kind=&from=&to=&format=csv|xlsx` | Skin Bank / Leprosy / CM Helpline register as CSV or real `.xlsx` (IDs kept exact, formulas never executed) | Register VIEW |
| GET | `/api/cron/monthly-reports?month=YYYY-MM&force=1` | Email a month's OPD + OT PDFs. `force` is honoured only for a signed-in Admin | `CRON_SECRET` bearer or Admin |
| GET | `/api/cron/daily` | Tomorrow's OT reminder + housekeeping | `CRON_SECRET` bearer or Admin |
