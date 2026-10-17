// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import type { ReactNode } from "react"
import { Big_Shoulders, Geist, Geist_Mono } from "next/font/google"
// Pretendard is self-hosted from node_modules (unicode-range subsets); no runtime CDN request. It sets the Hangul that Geist lacks.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"
import "./globals.css"

// The app screens. The landing and host chat in (site) have their own root layout and stylesheet, so their
// element-level rules never reach these Tailwind screens; moving between the two reloads the page.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })
const bigShoulders = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-big-shoulders" })

export const metadata = { title: { default: "Find Me a Time", template: "%s · Find Me a Time" } }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${geist.variable} ${geistMono.variable} ${bigShoulders.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-raised"
        >
          본문으로 건너뛰기
        </a>
        {children}
      </body>
    </html>
  )
}
