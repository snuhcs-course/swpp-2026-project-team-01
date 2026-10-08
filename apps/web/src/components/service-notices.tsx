// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { configured } from "@/lib/api"
import { Notice } from "@/lib/ui"

export function ServiceNotices() {
  const calendarResult = new URLSearchParams(location.search).get("calendar")
  return (
    <>
      {!configured && (
        <Notice>
          The scheduling service is being configured. Please try again later.
        </Notice>
      )}
      {calendarResult === "denied" && (
        <Notice>
          Google Calendar consent was not completed. You can reconnect, and
          requesters can continue with manual availability.
        </Notice>
      )}
      {calendarResult === "connected" && (
        <Notice>
          Google authorization returned to your request. Check the current
          connection status below.
        </Notice>
      )}
    </>
  )
}
