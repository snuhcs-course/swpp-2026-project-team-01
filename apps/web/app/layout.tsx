import type { Metadata } from "next";
import { Geist, Geist_Mono, Hahmlet, Instrument_Serif } from "next/font/google";
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

// The display face of every screen (DESIGN.md typography), and its Korean counterpart. Hahmlet's
// Korean glyphs come as unicode-range slices, which next/font cannot preload.
const instrumentSerif = Instrument_Serif({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  weight: "400",
});

const hahmlet = Hahmlet({
  preload: false,
  variable: "--font-hahmlet",
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
    <html className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${hahmlet.variable}`} lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
