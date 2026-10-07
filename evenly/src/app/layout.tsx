import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Icon } from "@/components/ui/primitives";
import { getCurrentUser } from "@/server/session";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Evenly — split expenses with your group",
  description: "Group expense splitting with flexible splits, multi-currency and minimal settle-up transfers.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#181a1f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="no-print sticky top-0 z-10 bg-bg/85 backdrop-blur-xl">
            <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2.5 text-[17px] font-bold leading-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-hero text-[15px] text-action">=</span>
                Evenly
              </Link>
              {user && (
                <span className="flex items-center gap-2 rounded-[30px] bg-surface py-1 pl-1 pr-3 text-[12px] leading-5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cloudy text-accent">
                    <Icon name="account" size={16} />
                  </span>
                  {user.displayName}
                </span>
              )}
            </div>
          </header>
          <main className="mx-auto max-w-2xl px-4 pb-28 pt-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
