import type { DopsAccess } from "@/lib/access";

type LimitEntry = { count: number; resetAt: number };
const limits = new Map<string, LimitEntry>();

export function rejectCrossSiteMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site")
    return Response.json({ success: false, message: "Cross-site request blocked." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ success: false, message: "Untrusted request origin." }, { status: 403 });
  return null;
}

export function enforceRequestSize(request: Request, maximumBytes: number) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximumBytes)
    return Response.json({ success: false, message: "Request is too large." }, { status: 413 });
  return null;
}

export function rateLimit(access: Pick<DopsAccess, "id">, scope: string, maximum: number, windowMs: number) {
  const now = Date.now(), key = `${access.id}:${scope}`, current = limits.get(key);
  const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + windowMs } : { ...current, count: current.count + 1 };
  limits.set(key, entry);
  if (limits.size > 500) for (const [storedKey, value] of limits) if (value.resetAt <= now) limits.delete(storedKey);
  if (entry.count <= maximum) return null;
  return Response.json(
    { success: false, message: "Too many requests. Please wait and try again." },
    { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))) } },
  );
}

export function actorDetails(access: Pick<DopsAccess, "id" | "role">, detail: string) {
  return `User #${access.id} (${access.role}): ${detail}`;
}

/**
 * Text for a spreadsheet cell. A value starting with = + - @ (or tab/CR)
 * would run as a formula when opened in Excel, so it is prefixed with '.
 */
export function spreadsheetSafe(value: unknown) {
  const text = String(value ?? "");
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) return text; // a plain number is harmless
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/**
 * Digit strings Excel would damage if read as numbers: 11+ digits (Aadhaar,
 * bank accounts) turn into 1.23E+11, and leading zeros are dropped.
 */
export const isFragileDigitString = (text: string) => /^\d+$/.test(text) && (text.length >= 11 || (text.length > 1 && text.startsWith("0")));

/** One quoted CSV cell: formula-safe, and ID-like numbers kept as exact text. */
export const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  // ="000123…" is read as text by Excel, LibreOffice and Google Sheets. Safe:
  // the content is digits only, so it cannot carry a formula.
  const cell = isFragileDigitString(text) ? `="${text}"` : spreadsheetSafe(text);
  return `"${cell.replaceAll('"', '""')}"`;
};
