import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { unlockConfig } from "@nano133/unlock/next";
import { SITE } from "@/content/posts";
import { Setup } from "./Setup";
import "./globals.css";

export const metadata: Metadata = { title: { default: SITE.name, template: `%s · ${SITE.name}` }, description: SITE.tagline };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The settings are read for each request, not at build time: a site that was built before its settings were
  // typed must not stay on the setup page.
  await connection();
  const config = unlockConfig();
  return (
    <html lang="en">
      <body>
        {config.ok ? (
          <>
            <header className="top">
              <Link href="/" className="brand">
                {SITE.name}
              </Link>
              <span className="tag">{SITE.tagline}</span>
            </header>
            <main className="page">{children}</main>
            <footer className="foot">
              <span>
                © {new Date().getFullYear()} {SITE.author}
              </span>
              <span>Paid parts use Nano Unlock: no account, no card.</span>
            </footer>
          </>
        ) : (
          <Setup problems={config.problems} />
        )}
      </body>
    </html>
  );
}
