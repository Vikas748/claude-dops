# DOPS Go-Live Checklist

Complete these checks with hospital-authorized representatives and dummy data. Add evidence in **Admin → Hospital UAT**.

## Governance

- [ ] Department owner and primary administrator named
- [ ] Backup owner and incident contact named
- [ ] Patient privacy, consent, retention and deletion policy approved
- [ ] Sign-in email account (SMTP) owned by the department, with password stored only in Vercel
- [ ] Production URL and private access list approved

## Access

- [ ] `/api/health?deep=1` fully green on the production URL
- [ ] `DATA_ENCRYPTION_KEY` set and an offline copy stored safely
- [ ] `CRON_SECRET` set; Vercel → Settings → Cron Jobs lists both jobs
- [ ] Report recipients confirmed (`REPORT_EMAILS` or active Admins)
- [ ] Admin sign-in (email code) and sign-out verified
- [ ] Sign-in email arrives within a minute and not in spam
- [ ] Doctor, Resident, Nurse and Staff accounts tested
- [ ] Module/action permissions verified for each role
- [ ] Pending and inactive accounts correctly blocked
- [ ] Access-review and staff-exit procedure documented

## Clinical workflow

- [ ] Global search works by name, Patient ID and diagnosis
- [ ] OPD registration creates a unique Patient ID
- [ ] OPD edit and soft delete verified
- [ ] Admit creates linked IPD without demographic re-entry
- [ ] IPD plan/management and Ayushman code verified
- [ ] Ward/bed and PAC updates verified
- [ ] OT today, tomorrow and previous views verified
- [ ] Pre-op and post-op upload/view/delete permissions verified
- [ ] Discharge card upload and discharge history verified
- [ ] CM Helpline creates a linked case without re-entry

## Academic and special modules

- [ ] Class PDF upload/search verified
- [ ] Research PDF upload/search verified
- [ ] Publication PDF and external link verified
- [ ] Skin recipient and donor add/edit/delete/export verified
- [ ] Leprosy add/edit/delete/export and sensitive-field masking verified

## Reports and resilience

- [ ] OPD PDF and CSV exports match the selected dates
- [ ] OT PDF and CSV exports match the selected dates
- [ ] Mobile layout checked on an approved phone
- [ ] Offline OPD queue/sync behaviour checked for the supported workflow
- [ ] Full recovery package downloaded and stored securely
- [ ] Restore drill completed in a non-production environment
- [ ] Audit records verified for login, edit, admission, OT and discharge

## Acceptance record

| Field | Value |
|---|---|
| Department representative | |
| Hospital IT/security representative | |
| Test date | |
| Accepted version/date | |
| Open limitations | |
| Decision | Approved / Conditional / Rejected |
