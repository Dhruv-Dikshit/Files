"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * Keeps every open tab in sync when other people (or your other devices)
 * add expenses: re-fetch server data when the tab regains focus and every
 * 20 seconds while it's visible. Cheap, because pages are small.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 20_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [router]);
  return children;
}
