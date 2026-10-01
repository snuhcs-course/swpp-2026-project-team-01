import type { ReactNode } from "react"
import { Header } from "@/components/Header"
import "./globals.css"

export const metadata = { title: "AI 미팅 예약" }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Header />
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
