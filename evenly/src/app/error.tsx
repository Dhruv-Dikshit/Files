"use client";

import { useEffect } from "react";
import { Button, Card, Icon, IconTile } from "@/components/ui/primitives";

/**
 * Last-resort screen for unexpected errors, instead of a blank page. A stale
 * tab after an update (old page, new server) is fixed by reloading, so that
 * happens automatically.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = /server action/i.test(error.message) && /not found|failed to find/i.test(error.message);
  useEffect(() => {
    if (stale) window.location.reload();
    else console.error(error);
  }, [error, stale]);

  return (
    <Card className="mt-10 px-6 py-10 text-center">
      <IconTile size={60} tone={2} className="mx-auto">
        <Icon name="notification" />
      </IconTile>
      <p className="mt-4 text-[17px] font-bold leading-6">{stale ? "Evenly was updated" : "Something went wrong"}</p>
      <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-muted">
        {stale ? "Reloading the page…" : "Your data is safe. Try again, and if it keeps happening check the server log with: docker compose logs app"}
      </p>
      {!stale && (
        <Button className="mt-5" onClick={() => reset()}>
          Try again
        </Button>
      )}
    </Card>
  );
}
