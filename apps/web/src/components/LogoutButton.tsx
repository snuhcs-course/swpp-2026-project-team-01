// AI-generated with Claude Code (claude-opus-5-5), 2026-10-05
"use client"
import { useState } from "react"
import { z } from "zod"
import { request } from "./api"
import { Button } from "./ui"

export function LogoutButton() {
  const [busy, setBusy] = useState(false)
  return (
    <Button size="sm" variant="link" disabled={busy} onClick={async () => {
      setBusy(true)
      await request("POST", "/api/auth/logout", z.object({ loggedOut: z.boolean() }), {})
      location.assign("/login")
    }}>로그아웃</Button>
  )
}
