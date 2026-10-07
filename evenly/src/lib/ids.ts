export function uid(prefix = ""): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return prefix ? `${prefix}_${random}` : random;
}

/** Today's date (YYYY-MM-DD) in the viewer's local time zone. */
export const today = () => new Date().toLocaleDateString("en-CA");
