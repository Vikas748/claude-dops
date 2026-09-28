import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const signedIn = Boolean(request.cookies.get("dops_session")?.value);
  const publicAuthPage = request.nextUrl.pathname === "/login";
  if (!signedIn && !publicAuthPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (signedIn && publicAuthPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.svg|manifest.webmanifest|sw.js|icons).*)"],
};
