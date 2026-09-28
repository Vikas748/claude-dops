import { timingSafeEqual } from "node:crypto";
import { getDopsAccess, isResponse } from "@/lib/access";
import { jsonError } from "@/lib/dops-db";
import { runDaily, runMonthlyReports } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by Vercel Cron (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
 * A signed-in Admin may also run a job by hand, e.g. to resend a month:
 *   /api/cron/monthly-reports?month=2026-09&force=1
 */
async function authorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (secret && secret.length >= 16) {
    const expected = Buffer.from(`Bearer ${secret}`), given = Buffer.from(header);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return "cron";
  }
  const access = await getDopsAccess().catch(() => null);
  return access && !isResponse(access) && access.role === "ADMIN" ? "admin" : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const who = await authorised(request);
  if (!who) return jsonError("Not authorised.", 401);
  const job = (await params).job;
  const url = new URL(request.url);
  // Only a person can force a re-run; a duplicate cron call must stay a no-op.
  const force = who === "admin" && url.searchParams.get("force") === "1";
  try {
    if (job === "monthly-reports") {
      const month = url.searchParams.get("month") ?? undefined;
      return Response.json({ success: true, data: await runMonthlyReports({ month, force }) });
    }
    if (job === "daily") return Response.json({ success: true, data: await runDaily({ force }) });
    return jsonError("Unknown job.", 404);
  } catch (error) {
    console.error(`Cron job ${job} failed`, error);
    return jsonError(error instanceof Error ? error.message : "Job failed.", 500);
  }
}
