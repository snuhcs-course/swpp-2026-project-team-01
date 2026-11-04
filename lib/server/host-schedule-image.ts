import { MAX_CALENDAR_IMAGE_BYTES } from "../contracts/calendar-screenshot";
import { SETUP_FIELD_SCHEMAS } from "../contracts/setup";
import { boundedFormData, validateCalendarImage, type CalendarImageType } from "./calendar-screenshot";
import { json } from "./chat-routes";
import { createOpenAiWeeklyScheduleExtractor } from "./host-schedule-image-openai";
import { ModelLimitError, reserveHostCalendarOcr } from "./model-limits";
import { crossSiteRefusal } from "./same-origin";
import { eligibleHost, setupRouteDependenciesFromEnvironment, type SetupRouteDependencies } from "./setup-routes";

export type HostScheduleImageDependencies = SetupRouteDependencies & {
  readonly extract?: (image: Uint8Array, type: CalendarImageType) => Promise<unknown>;
};

export function createHostScheduleImageHandler(load: () => HostScheduleImageDependencies = () => {
  const apiKey = process.env.CALENDAR_OCR_API_KEY || process.env.OPENAI_API_KEY;
  return {
    ...setupRouteDependenciesFromEnvironment(),
    extract: process.env.CALENDAR_OCR_ENABLED === "true" && apiKey ? createOpenAiWeeklyScheduleExtractor({ apiKey }) : undefined,
  };
}) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: false });
    if (refused) return refused;
    const actor = await eligibleHost(request, deps);
    if (actor instanceof Response) return actor;
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) return json({ error: "Select a PNG, JPEG or WebP image." }, 415);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_CALENDAR_IMAGE_BYTES + 4096) return json({ error: "Use an image under 10 MB." }, 413);
    const form = await boundedFormData(request);
    if (form === "too_large") return json({ error: "Use an image under 10 MB." }, 413);
    const file = form?.get("image");
    if (!(file instanceof File)) return json({ error: "Select a timetable image." }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateCalendarImage(bytes, file.type);
    if (checked.kind === "too_large") return json({ error: "Use an image under 10 MB." }, 413);
    if (checked.kind !== "valid") return json({ error: "Select a valid PNG, JPEG or WebP image." }, 415);
    if (!deps.extract) return json({ error: "Image reading is unavailable. You can enter weekly hours manually." }, 503);
    try {
      await reserveHostCalendarOcr(deps.db, actor.id);
    } catch (cause) {
      return json({ error: cause instanceof ModelLimitError ? "Image reading is limited right now. You can enter weekly hours manually." : "Image reading is unavailable. You can enter weekly hours manually." }, cause instanceof ModelLimitError ? 429 : 503);
    }
    try {
      const extracted = await deps.extract(bytes, checked.type!);
      const windows = SETUP_FIELD_SCHEMAS.weeklyWindows.safeParse(extracted);
      if (!windows.success) {
        // Empty output is a legitimate uncertainty, not a schedule.
        if (Array.isArray(extracted) && extracted.length === 0) return json({ windows: [] });
        return json({ error: "The image did not contain clear weekly hours. Enter them manually." }, 422);
      }
      return json({ windows: windows.data });
    } catch {
      return json({ error: "The image could not be read. Enter weekly hours manually." }, 503);
    }
  };
}
