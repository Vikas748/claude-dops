# DOPS API for the mobile app

The mobile app uses the same backend as the website. This page covers what is different for a native client. The full endpoint list is in `API_REFERENCE.md`.

Base URL: the deployed site, e.g. `https://dops-example.vercel.app`. All bodies are JSON (`content-type: application/json`).

## 1. Sign in (email OTP)

```http
POST /api/auth/request-otp
{ "email": "doctor@hospital.in" }
```
Always answers `200` with a neutral message (whether or not the email is registered). A code is emailed only to `ACTIVE` users. `429` means wait: the body has `retryAfter` (seconds). Show a resend timer using `resendAfter` from the `200` reply.

```http
POST /api/auth/verify-otp
{ "email": "doctor@hospital.in", "code": "482915", "client": "MOBILE" }
```
`200` → `{ "success": true, "user": { "name", "role" }, "token": "…", "expiresAt": "…" }`.
With `"client": "MOBILE"` the session token is returned in the body (the website gets a cookie instead). `401` = wrong/expired code (`message` says how many attempts are left); after 5 wrong attempts a new code is needed. `403` = the account is not active.

Store the token in the platform's secure storage (iOS Keychain / Android Keystore), never in plain preferences.

## 2. Calling the API

Send the token on every request:

```http
Authorization: Bearer <token>
```

- The session lasts 30 days from the **last use** (it extends automatically while the app is used).
- **Any `401` means the session has ended** (expired, signed out elsewhere, or the user was deactivated): delete the stored token and show the sign-in screen.
- `403` means the user lacks permission for that module: show a message, do not sign out.
- `GET /api/access` returns the user's role and module permissions (e.g. `OPD:VIEW`, `OT:CREATE`); use it to decide which screens to show.

Sign out:

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

## 3. Uploading files (PDFs, OT photos, discharge cards)

Files never go through the DOPS API. Three steps:

1. `POST /api/uploads` with `{ purpose, fileName, contentType, size, … }` — `purpose` is `ACADEMIC` (+ `kind`), `OT_IMAGE` (+ `otId`, `imageType`: `PRE_OP`/`POST_OP`) or `DISCHARGE_CARD` (+ `wardId`). Answer: `{ uploadId, uploadUrl }`.
2. `PUT` the raw file bytes to `uploadUrl` with the same `content-type`. **No Authorization header** here — the URL is already signed. Valid for 2 hours.
3. Call the module API with the `uploadId` (e.g. `POST /api/ot-images` with `{ otId, imageType, uploadIds: [...] }`).

Limits: PDF 15 MB, OT image 8 MB (JPG/PNG/WebP), discharge card 10 MB (PDF/JPG/PNG). The server checks the real file bytes, so a renamed file is rejected. Compressing phone photos before upload is recommended.

## 4. Viewing files

`GET /api/files?key=<fileKey>` with the Bearer header answers `302` to a signed storage link valid for 2 minutes. Let the HTTP client follow the redirect **without** forwarding the Authorization header to the storage host (most clients drop it on cross-host redirects automatically), or read the `Location` header and open that link.

## 5. Dates and times

Dates are `YYYY-MM-DD` in India time; OT times are `HH:MM` (24-hour). The server rejects other formats.
