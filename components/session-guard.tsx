"use client";

import { useEffect } from "react";

/**
 * If the session ends while someone is working (expired after 30 idle days,
 * signed out on another device, or access deactivated by an Admin), every
 * API call starts returning 401. Without this, each module only showed its
 * own error message and the user stayed on a page that could not load data.
 *
 * This wraps window.fetch once: a 401 from any DOPS API (other than the
 * sign-in endpoints themselves) clears the session and opens the sign-in
 * page with "Your session has ended".
 */
const IGNORED = ["/api/auth/", "/api/health"];

export function SessionGuard() {
  useEffect(() => {
    if (window.location.pathname === "/login") return;
    const original = window.fetch;
    let redirecting = false;
    const guarded: typeof window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (response.status === 401 && !redirecting) {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.href);
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !IGNORED.some((p) => url.pathname.startsWith(p))) {
          redirecting = true;
          window.location.replace("/api/auth/logout?reason=expired");
        }
      }
      return response;
    };
    window.fetch = guarded;
    return () => {
      if (window.fetch === guarded) window.fetch = original;
    };
  }, []);
  return null;
}
