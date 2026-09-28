import { getSessionUser, revokeAllSessions } from "@/lib/auth";
import { jsonError } from "@/lib/dops-db";

export type DopsAccess = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: string[];
};

/**
 * Resolves the signed-in user from their DOPS session (cookie or Bearer token).
 * Status is re-checked on every request, so deactivation takes effect immediately.
 */
export async function getDopsAccess(): Promise<DopsAccess | Response> {
  let user;
  try {
    user = await getSessionUser();
  } catch (error) {
    console.error("Session lookup failed", error);
    return jsonError("Sign-in service is temporarily unavailable.", 503);
  }
  if (!user) return jsonError("Authentication required.", 401);
  if (user.status !== "ACTIVE") {
    // Deactivated or pending: end all their sessions and send them to login.
    await revokeAllSessions(user.id).catch((error) => console.error("Session revoke failed", error));
    return jsonError(
      user.status === "PENDING" ? "Your account is awaiting administrator approval." : "Your access has been deactivated.",
      401,
    );
  }
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(String(user.permissions ?? "[]"));
    if (Array.isArray(parsed)) permissions = parsed.map(String);
  } catch {}
  return {
    id: user.id,
    name: String(user.name),
    email: String(user.email),
    role: String(user.role),
    status: String(user.status),
    permissions,
  };
}

export async function requireModule(
  module: string,
): Promise<DopsAccess | Response> {
  const access = await getDopsAccess();
  if (access instanceof Response) return access;
  if (!hasModule(access, module))
    return jsonError(`${module.replaceAll("_", " ")} access required.`, 403);
  return access;
}

export function hasModule(access: DopsAccess, module: string) {
  return (
    access.role === "ADMIN" ||
    access.permissions.includes(module) ||
    access.permissions.some((permission) => permission.startsWith(`${module}:`))
  );
}

export type PermissionAction = "VIEW" | "CREATE" | "EDIT" | "DELETE" | "EXPORT";

export function hasPermission(
  access: DopsAccess,
  module: string,
  action: PermissionAction,
) {
  return (
    access.role === "ADMIN" ||
    access.permissions.includes(module) ||
    access.permissions.includes(`${module}:${action}`)
  );
}

export async function requirePermission(
  module: string,
  action: PermissionAction,
): Promise<DopsAccess | Response> {
  const access = await getDopsAccess();
  if (access instanceof Response) return access;
  if (!hasPermission(access, module, action))
    return jsonError(
      `${action.toLowerCase()} permission required for ${module.replaceAll("_", " ")}.`,
      403,
    );
  return access;
}
export function isResponse(value: DopsAccess | Response): value is Response {
  return value instanceof Response;
}
