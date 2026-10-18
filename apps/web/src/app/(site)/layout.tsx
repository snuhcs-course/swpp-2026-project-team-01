// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { siteLocale } from "./locale";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const bigShoulders = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-big-shoulders" });

export const metadata: Metadata = {
  title: "Find Me a Time",
  description: "Send one link. Thyme finds the time.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions (seen: an HWP viewer) add attributes to <html> before React loads; ignore those, as the app layout does.
    <html lang={await siteLocale()} className={`${geist.variable} ${geistMono.variable} ${bigShoulders.variable}`} suppressHydrationWarning>
      <body>
        <div className="stage">
          <div className="page">{children}</div>
        </div>
      </body>
    </html>
  );
}
