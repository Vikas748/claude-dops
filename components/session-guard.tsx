"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * Session and app-lock guard for every signed-in page.
 *
 * 1. App lock: every time DOPS is opened again (new tab, browser or installed
 *    app launch) it must be unlocked with the PIN. sessionStorage is empty in a
 *    new tab/launch, so the server-side unlock is dropped and the PIN screen
 *    opens. The server enforces the lock too (APIs answer 423 while locked).
 * 2. A 401 from any DOPS API (session expired, signed out elsewhere, access
 *    deactivated) signs out cleanly to the sign-in page. A 423 (locked) opens
 *    the PIN screen without signing out.
 */
export const OPEN_FLAG = "dops_unlocked"; // set by the sign-in page after unlocking
const IGNORED = ["/api/auth/", "/api/health"];
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SessionGuard() {
  const [locking, setLocking] = useState(false);

  // Runs before the first paint, so no patient data flashes on a locked screen.
  useIsoLayoutEffect(() => {
    if (window.location.pathname === "/login") return;
    let opened = false;
    try {
      opened = window.sessionStorage.getItem(OPEN_FLAG) === "1";
    } catch {}
    if (opened) return;
    setLocking(true);
    fetch("/api/auth/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "lock" }) })
      .catch(() => {})
      .finally(() => window.location.replace("/login?locked=1"));
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/login") return;
    const original = window.fetch;
    let redirecting = false;
    const guarded: typeof window.fetch = async (input, init) => {
      const response = await original(input, init);
      if ((response.status === 401 || response.status === 423) && !redirecting) {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.href);
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !IGNORED.some((p) => url.pathname.startsWith(p))) {
          redirecting = true;
          if (response.status === 423) {
            try { window.sessionStorage.removeItem(OPEN_FLAG); } catch {}
            window.location.replace("/login?locked=1");
          } else {
            window.location.replace("/api/auth/logout?reason=expired");
          }
        }
      }
      return response;
    };
    window.fetch = guarded;
    return () => {
      if (window.fetch === guarded) window.fetch = original;
    };
  }, []);

  return locking ? <div className="app-lock-cover" aria-hidden="true" /> : null;
}
