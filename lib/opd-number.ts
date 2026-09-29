/**
 * OPD No. / UHID No.: required for every patient, unique among active patients.
 * Server-only module.
 */
import { getDopsDb } from "@/lib/dops-db";

/** Trims and tidies the number; returns an error message or the clean value. */
export function readOpdNumber(value: unknown): { value: string } | { error: string } {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { error: "Enter the OPD No. / UHID No." };
  if (text.length > 40) return { error: "OPD No. / UHID No. is too long (40 characters at most)." };
  if (!/^[A-Za-z0-9][A-Za-z0-9 /\-.]*$/.test(text)) return { error: "OPD No. / UHID No. may contain only letters, numbers, spaces and / - ." };
  return { value: text };
}

/** The patient already using this number (other than `exceptPatientId`), if any. */
export async function opdNumberOwner(opdNumber: string, exceptPatientId = 0) {
  return getDopsDb()
    .prepare(
      `SELECT patient_code AS "patientCode", name FROM patients
        WHERE deleted_at IS NULL AND lower(opd_number) = lower(?) AND id <> ? LIMIT 1`,
    )
    .bind(opdNumber, exceptPatientId)
    .first<{ patientCode: string; name: string }>();
}

export const duplicateOpdMessage = (opdNumber: string, owner: { patientCode: string; name: string }) =>
  `OPD No. / UHID No. "${opdNumber}" is already used by ${owner.name} (${owner.patientCode}).`;

/** Postgres unique-index violation on the OPD number (a race between two saves). */
export const isOpdNumberConflict = (error: unknown) =>
  (error as { code?: string; constraint_name?: string })?.code === "23505" &&
  String((error as { constraint_name?: string })?.constraint_name ?? (error as Error)?.message ?? "").includes("opd_number");
