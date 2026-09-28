import { getDopsAccess, isResponse } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getDopsAccess();
  if (isResponse(access)) return access;
  return Response.json({
    success: true,
    data: {
      role: access.role,
      status: access.status,
      permissions: access.permissions,
      name: access.name,
      email: access.email,
      authMethod: "EMAIL_OTP",
    },
  });
}
