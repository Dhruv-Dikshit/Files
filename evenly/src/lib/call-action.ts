import type { ActionResult } from "@/lib/types";

/**
 * Call a Server Action from the browser without ever failing silently.
 * Server Actions report expected problems as { ok: false, error }, but the
 * call itself can still throw: the server is down, the network dropped, or
 * the app was rebuilt while this tab stayed open (the old page then asks
 * for an action ID the new server doesn't have). Those become readable
 * errors, and the stale-page case reloads automatically.
 */
export async function callAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/server action/i.test(message) && /not found|failed to find/i.test(message)) {
      window.location.reload();
      return { ok: false, error: "Evenly was updated. Reloading the page…" };
    }
    console.error(err);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ok: false, error: "You're offline. Check your connection and try again." };
    }
    return { ok: false, error: "Couldn't reach Evenly. Make sure it's running (docker compose ps), then try again." };
  }
}
