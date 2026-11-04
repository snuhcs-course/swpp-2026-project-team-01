import { createHostScheduleImageHandler } from "@lib/server/host-schedule-image";

const handle = createHostScheduleImageHandler();

export function POST(request: Request) {
  return handle(request);
}
