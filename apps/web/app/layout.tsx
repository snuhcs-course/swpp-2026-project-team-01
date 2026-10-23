import type { Metadata } from "next";
import { Big_Shoulders, Geist, Geist_Mono, Merriweather } from "next/font/google";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const title = "Find Me a Time";
const description = "An AI scheduling agent for external one-to-one meetings.";

function resolveMetadataBase() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL;

  if (!configuredUrl) {
    return new URL("http://localhost:3000");
  }

  return new URL(configuredUrl.startsWith("http") ? configuredUrl : `https://${configuredUrl}`);
}

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

// The wordmark and headings of the landing and the iMessage link screens (the ink
// screens, apps/web/app/_components/ink).
const bigShoulders = Big_Shoulders({
  axes: ["opsz"],
  subsets: ["latin"],
  variable: "--font-big-shoulders",
});

// Editorial display headings (DESIGN.md typography).
const merriweather = Merriweather({
  subsets: ["latin"],
  variable: "--font-merriweather",
  weight: ["400"],
});

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title,
  description,
  applicationName: title,
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title,
    description,
    siteName: title,
    type: "website",
  },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable} ${merriweather.variable} ${bigShoulders.variable}`} lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
