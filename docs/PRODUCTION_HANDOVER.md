# DOPS Production Handover

## 1. System purpose

DOPS manages the daily clinical and academic work of the Department of Burn & Plastic Surgery, NSCB Medical College Jabalpur. A single DOPS Patient ID follows the patient through OPD, IPD, Ward, OT, discharge and optional CM Helpline tracking.

## 2. Production architecture

| Layer | Implementation | Responsibility |
|---|---|---|
| Web application | Next.js, React, TypeScript on Vercel | Responsive user interface and API routes |
| Identity | 6-digit email OTP sent through the department SMTP account | Verified user identity; no passwords; revocable database sessions |
| Authorization | DOPS role and permission records | Admin, Doctor, Resident, Nurse and Staff access |
| Clinical database | Supabase PostgreSQL | Patients, visits, admissions, OT, registers, users and audit history |
| File storage | Private Supabase Storage | Academic PDFs, discharge cards and OT images |
| Runtime | Vercel Functions | Server-side access checks and business rules |

All clinical write operations are checked server-side. The interface hiding a button is not treated as authorization.

## 3. Access and onboarding

1. In **Admin → Users**, pre-create the staff member's exact email address, select the role, choose only required permissions and set the status to `ACTIVE`.
2. Share the production URL only through the department's approved channel.
3. Ask the staff member to open DOPS, enter that email address and type the 6-digit code they receive.
4. The code proves they control the email address; they are signed in to the pre-created account.
5. Confirm the name, role and permitted modules shown in the application.

Only pre-created `ACTIVE` accounts receive a sign-in code; any other address gets the same neutral message and no email. Setting a user to `INACTIVE` or `PENDING` ends all of their sessions on their next request. Their audit history is kept.

## 4. Permission model

The available actions are `VIEW`, `CREATE`, `EDIT`, `DELETE` and `EXPORT` for OPD, IPD, WARD, OT, CLASS, SKIN_BANK, RESEARCH, PUBLICATION, LEPROSY and CM_HELPLINE. Admin has complete access. Other users should receive the minimum permissions required for their duty.

Recommended starting point:

| Role | Suggested access |
|---|---|
| Doctor | Clinical modules; edit IPD plan; schedule/update OT; reports when required |
| Resident | OPD creation, clinical viewing and delegated clinical edits |
| Nurse | IPD/Ward viewing; Ward/PAC updates; discharge upload when assigned |
| Staff | Registration, approved registers and exports only as required |

Review permissions during transfers, rotations and departures. Never share user identities.

## 5. Patient workflow

1. Register the patient in OPD; DOPS creates the unique Patient ID.
2. Use **Admit** on the OPD record; do not enter a duplicate patient in IPD.
3. Update IPD diagnosis, plan/management and Ayushman code.
4. Move the admission to Ward and update ward/bed and PAC status.
5. Schedule OT from the linked admission; attach pre-op and post-op images to that OT case.
6. Upload the discharge card and discharge the Ward stay.
7. When required, add the existing OPD/IPD patient to CM Helpline rather than re-entering demographics.

OPD delete is a soft delete. Historical and audit records remain available to authorized administrators.

## 6. Reports and registers

- OPD and OT provide date-range PDF and CSV exports.
- Skin Bank recipient/donor registers and Leprosy provide CSV/Excel-compatible exports.
- Non-admin users see masked Aadhaar and bank-account values in the Leprosy register.
- Exports contain health information and must be stored and shared only through hospital-approved channels.

## 7. Backup and restore

Only an administrator should use **Admin → System Recovery**.

Backup procedure:

1. Announce a brief change-free window to clinical users.
2. Download the full recovery package.
3. Store it in the hospital's approved encrypted backup location.
4. Record the date, administrator and storage reference in the hospital backup register.
5. Test opening the package in a controlled environment; do not alter its contents.

Restore procedure:

1. Use restore only after confirming data corruption/loss and obtaining the authorized decision.
2. Download a fresh pre-restore backup whenever the current system remains accessible.
3. Verify the selected recovery package belongs to this DOPS installation.
4. Keep users out of the application while restoration runs.
5. After restore, verify user access, recent patient records, one stored file, one report and the audit log.
6. Record the incident and verification result.

Restore is a high-impact action. Never practise it on the live hospital database; use an approved test environment.

## 8. Security and privacy operations

- Keep the Site private and grant access only to authorized hospital personnel.
- Review active accounts monthly and deactivate access immediately when duties end.
- Use dummy patients for training and UAT.
- Avoid downloading clinical exports to shared or unmanaged devices.
- Treat OT images, discharge cards, Aadhaar and bank details as sensitive health/personal data.
- Review the audit log after access changes, restores and suspected incidents.
- Establish hospital-approved retention, deletion, breach-response and patient-consent policies before full clinical rollout.

## 9. Authentication

Users sign in with a 6-digit code emailed through the SMTP account configured in `SMTP_*` settings. Codes are valid for 10 minutes, single use, and locked after 5 wrong attempts. Code requests are limited per email and per network. Sessions last 30 days from the last use, are stored hashed in `auth_sessions`, and end on sign-out, deactivation or restore. SMS OTP is deferred.

The production owner must protect the SMTP password and `AUTH_SECRET`, and monitor that sign-in emails are delivered (check the spam folder during testing). Moving from a Gmail account to a transactional provider such as Brevo only requires changing the `SMTP_*` settings.

## 10. Incident and rollback checklist

1. Stop further data entry if integrity may be affected.
2. Note the time, affected user, patient IDs and exact action without copying unnecessary patient data.
3. Preserve logs and download a recovery package if safe.
4. Revoke or deactivate compromised access.
5. Escalate according to the hospital incident-response process.
6. Roll back application code only to a known saved version; restore data only through the controlled restore procedure.
7. Validate the clinical workflow before reopening access.

## 11. Acceptance

Production acceptance should be signed only after every required item in `GO_LIVE_CHECKLIST.md` is completed with hospital-authorized users and dummy data. Record open limitations and their owner rather than marking an untested item as passed.
