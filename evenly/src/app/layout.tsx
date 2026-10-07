import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/server/session";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Evenly — split expenses with your group",
  description: "Group expense splitting with flexible splits, multi-currency and minimal settle-up transfers.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="no-print sticky top-0 z-10 border-b border-zinc-200/70 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-sm text-white">=</span>
                Evenly
              </Link>
              {user && <span className="text-sm text-zinc-500">Hi, {user.displayName}</span>}
            </div>
          </header>
          <main className="mx-auto max-w-2xl px-4 pb-28 pt-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
