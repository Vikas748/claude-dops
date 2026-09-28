# DOPS Admin Quick Start

## First login

Open the private DOPS link, enter your email, and type the 6-digit code you receive. Confirm that the sidebar shows your email and `ADMIN`. The very first admin is the address set in `DOPS_BOOTSTRAP_ADMIN_EMAIL`; later admins are added by an existing admin.

## Add a user

1. Open **Admin → Users**.
2. Enter name, the person's exact email and optional mobile number.
3. Select `DOCTOR`, `RESIDENT`, `NURSE` or `STAFF`.
4. Grant only the module actions required for that person's work.
5. Set status to `ACTIVE` and save.
6. Ask the person to sign in once with the emailed code; check the `LOGIN` entry in the audit log.

Only `ACTIVE` users receive sign-in codes. Use `PENDING` when approval is not complete and `INACTIVE` to revoke access; changing a signed-in user to either signs them out immediately. DOPS prevents an administrator from removing their own active admin access.

## Daily checks

- Dashboard counts and alerts load without errors.
- Pending PAC items and upcoming OT cases are reviewed.
- New users or access-change requests are resolved.
- Failed/denied login and important clinical actions are reviewed when necessary.

## Monthly tasks

- Export OPD and OT reports for the approved date range.
- Export required Skin Bank and Leprosy registers.
- Review active users and minimum permissions.
- Download and securely store a recovery package.
- Check UAT/operational evidence and unresolved issues.

## Safe training

Use clearly labelled dummy patients only. Test the complete OPD → IPD → Ward → OT → Discharge flow, including one pre-op image, one post-op image and a discharge card. Remove test access or data according to hospital policy after acceptance.

## If access fails

- Confirm the user opened the correct private DOPS link.
- Confirm the signed-in email exactly matches the Admin user record.
- Confirm status is `ACTIVE` and required permissions are selected.
- If DOPS reports that the email is linked to another identity, do not create duplicate accounts; investigate and use the approved identity.

## Before restore

Stop routine data entry, obtain authorization, download a fresh backup if possible and verify the recovery package. After restore, check users, recent patients, documents, reports and audit logs before reopening the system.
