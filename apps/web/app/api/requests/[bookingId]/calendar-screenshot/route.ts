import { createCalendarScreenshotHandler } from "@lib/server/calendar-screenshot";

const handle = createCalendarScreenshotHandler();
type Context = { params: Promise<{ bookingId: string }> };

export function POST(request: Request, context: Context) {
  return handle(request, context);
}
