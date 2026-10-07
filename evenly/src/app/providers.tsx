"use client";

import { useEffect, type ReactNode } from "react";
import { hydrateStore } from "@/lib/store/store";

/**
 * Demo: hydrate the local store after mount. Production replaces this with
 * a query-cache provider (TanStack Query) + a Supabase Realtime subscription
 * per open group that invalidates/patches cached data on remote changes.
 */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => hydrateStore(), []);
  return children;
}
