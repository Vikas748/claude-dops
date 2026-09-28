-- DOPS migration 005: client change round 1.
-- Safe to run more than once. Run in Supabase SQL Editor after 004.

-- 1) Class / Research / Publication entries can be added first and the PDF
--    uploaded later (Edit), so the file columns become optional.
alter table academic_documents alter column file_key  drop not null;
alter table academic_documents alter column file_name drop not null;

-- 2) CM Helpline now has only Pending and Resolved.
update special_records set status = 'PENDING'
 where kind = 'HELPLINE' and status = 'IN_PROGRESS';
