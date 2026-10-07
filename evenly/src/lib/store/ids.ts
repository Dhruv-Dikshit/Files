export function uid(prefix = ""): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return prefix ? `${prefix}_${random}` : random;
}

/** Readable invite code like "GOA-7K3P" (no 0/O/1/I ambiguity). */
export function inviteCode(name: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const prefix = name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${suffix}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => new Date().toISOString();

const AVATAR_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#8b5cf6"];
export const avatarColor = (index: number) => AVATAR_COLORS[index % AVATAR_COLORS.length];
