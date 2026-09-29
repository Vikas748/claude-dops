import { getDopsDb, jsonError } from "@/lib/dops-db";
import { createSession, getSessionUser } from "@/lib/auth";
import {
  claimPinAttempt,
  currentDevice,
  forgetDevice,
  isValidPin,
  maskedEmail,
  pinMatches,
  PIN_MAX_ATTEMPTS,
  recordPinSuccess,
  registerDevicePin,
  weakPinReason,
} from "@/lib/device-pin";
import { enforceRequestSize, rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";

const audit = (action: string, userId: number, details: string) =>
  getDopsDb()
    .prepare("INSERT INTO audit_logs (action,module,record_id,details,created_at) VALUES (?,'AUTH',?,?,?)")
    .bind(action, userId, `User #${userId}: ${details}`, new Date().toISOString())
    .run();

/**
 * GET: does this browser have a PIN? Used by the sign-in page to show
 * "Welcome back — enter your PIN". Reveals only a first name and a masked email.
 */
export async function GET() {
  try {
    const device = await currentDevice();
    if (!device || device.status !== "ACTIVE")
      return Response.json({ success: true, data: { enabled: false } }, { headers: { "cache-control": "no-store" } });
    return Response.json(
      {
        success: true,
        data: {
          enabled: !device.locked,
          locked: device.locked,
          name: device.name.includes("@") ? device.name.split("@")[0] : device.name.split(" ")[0],
          email: maskedEmail(device.email),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("PIN status failed", error);
    return Response.json({ success: true, data: { enabled: false } });
  }
}

/**
 * POST { action: "setup", pin, confirm }  — signed-in user sets a PIN for this browser.
 * POST { action: "login", pin }           — sign in with the PIN on this browser.
 */
export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request) ?? enforceRequestSize(request, 2 * 1024);
    if (rejected) return rejected;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");

    if (action === "setup") {
      const user = await getSessionUser();
      if (!user || user.status !== "ACTIVE") return jsonError("Sign in with your email code first.", 401);
      if (!isValidPin(b.pin)) return jsonError("Enter a 4-digit PIN.");
      if (b.pin !== b.confirm) return jsonError("The two PINs do not match.");
      const weak = weakPinReason(b.pin);
      if (weak) return jsonError(weak);
      await registerDevicePin(user.id, b.pin);
      await audit("PIN_SET", user.id, "PIN set for this device");
      return Response.json({ success: true });
    }

    if (action === "login") {
      if (!isValidPin(b.pin)) return jsonError("Enter your 4-digit PIN.");
      const device = await currentDevice();
      if (!device) return jsonError("No PIN is set on this device. Sign in with your email code.", 401);
      if (device.status !== "ACTIVE") return jsonError("Your access is not active. Contact the department administrator.", 403);
      const left = await claimPinAttempt(device.id);
      if (left === null)
        return jsonError("Your PIN is locked after too many attempts. Sign in with your email code to set a new PIN.", 423);
      if (!pinMatches(b.pin, device.pinHash)) {
        if (left <= 0) {
          await audit("PIN_LOCKED", device.userId, `PIN locked after ${PIN_MAX_ATTEMPTS} wrong attempts`);
          return jsonError("Too many wrong PINs. Your PIN is locked; sign in with your email code to set a new one.", 423);
        }
        return jsonError(`Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`, 401);
      }
      await recordPinSuccess(device.id);
      await createSession(device.userId, "WEB");
      const now = new Date().toISOString();
      await getDopsDb().prepare("UPDATE department_users SET last_login=? WHERE id=?").bind(now, device.userId).run();
      await audit("LOGIN", device.userId, "PIN sign-in (WEB)");
      return Response.json({ success: true });
    }

    return jsonError("Invalid request.");
  } catch (error) {
    console.error("PIN request failed", error);
    return jsonError("Sign-in is temporarily unavailable. Please try again shortly.", 503);
  }
}

/** DELETE — remove the PIN from this browser ("Not you?" / shared computer). */
export async function DELETE(request: Request) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  try {
    await forgetDevice();
    return Response.json({ success: true });
  } catch (error) {
    console.error("Forget device failed", error);
    return jsonError("Could not remove the PIN from this device.", 503);
  }
}
