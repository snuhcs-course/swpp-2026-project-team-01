import type { ReactNode } from "react"
// Pretendard is self-hosted from node_modules (unicode-range subsets); no runtime CDN request.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"
import "./globals.css"

export const metadata = { title: { default: "AI 미팅 예약", template: "%s · AI 미팅 예약" } }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
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
