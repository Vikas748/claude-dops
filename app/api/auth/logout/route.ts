import { revokeCurrentSession } from "@/lib/auth";
import { rejectCrossSiteMutation } from "@/lib/security";

export const dynamic = "force-dynamic";

async function logout() {
  try {
    await revokeCurrentSession();
  } catch (error) {
    // Even if the DB is unreachable, the cookie is cleared below by the redirect path.
    console.error("Logout revoke failed", error);
  }
}

/** Web: the sign-out link in the header. */
export async function GET(request: Request) {
  await logout();
  const target = new URL("/login", request.url);
  if (new URL(request.url).searchParams.get("reason") === "expired") target.searchParams.set("expired", "1");
  return Response.redirect(target);
}

/** Mobile app / fetch clients. */
export async function POST(request: Request) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  await logout();
  return Response.json({ success: true });
}
