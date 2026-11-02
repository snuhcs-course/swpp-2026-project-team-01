import { MAX_CALENDAR_IMAGE_BYTES } from "../contracts/calendar-screenshot";
import { isValidTimeZone } from "../contracts/timezone";
import { createOpenAiCalendarExtractor } from "./calendar-screenshot-openai";
import { REQUESTER_HEADERS, requesterJson, requestUnavailable } from "./confirmation-routes";
import { database, type Database } from "./database";
import { ModelLimitError, reserveCalendarOcr } from "./model-limits";
import { openRequester } from "./requester-routes";
import { appOriginsFromEnvironment, crossSiteRefusal, type AppOrigins } from "./same-origin";
import { z } from "zod";

export type CalendarImageType = "image/png" | "image/jpeg" | "image/webp";
export type CalendarImageResult = { readonly kind: "invalid" | "too_large" | "valid"; readonly type?: CalendarImageType };

export function validateCalendarImage(bytes: Uint8Array, claimedType: string): CalendarImageResult {
  if (bytes.length > MAX_CALENDAR_IMAGE_BYTES) return { kind: "too_large" };
  if (bytes.length < 24) return { kind: "invalid" };
  const pngHeader = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(8) === 13 &&
    String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR" &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(16) > 0 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(20) > 0;
  let png = false;
  if (pngHeader) {
    let offset = 8;
    let hasImageData = false;
    while (offset + 12 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
      if (length > bytes.length - offset - 12) break;
      const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (name === "IDAT") hasImageData = true;
      offset += length + 12;
      if (name === "IEND") { png = length === 0 && hasImageData && offset === bytes.length; break; }
    }
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const webp = String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) + 8 === bytes.length &&
    ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.subarray(12, 16)));
  const type = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  return type && type === claimedType ? { kind: "valid", type } : { kind: "invalid" };
}

export type CalendarScreenshotExtractor = (image: Uint8Array, type: CalendarImageType, timezone: string) => Promise<unknown>;
export type CalendarScreenshotDependencies = AppOrigins & { readonly db: Database; readonly extract?: CalendarScreenshotExtractor };
const markSchema = z.object({
  date: z.iso.date(),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  interpretation: z.enum(["busy", "free", "unknown"]),
}).strict().refine((mark) => mark.start < mark.end);

async function boundedFormData(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_CALENDAR_IMAGE_BYTES + 4096) {
      await reader.cancel();
      return "too_large" as const;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Request(request.url, { body: bytes, headers: { "content-type": request.headers.get("content-type")! }, method: "POST" }).formData().catch(() => null);
}

export function createCalendarScreenshotHandler(
  load: () => CalendarScreenshotDependencies = () => {
    const apiKey = process.env.CALENDAR_OCR_API_KEY || process.env.OPENAI_API_KEY;
    return { ...appOriginsFromEnvironment(), db: database(), extract: process.env.CALENDAR_OCR_ENABLED === "true" && apiKey ? createOpenAiCalendarExtractor({ apiKey }) : undefined };
  },
) {
  return async (request: Request, context: { params: Promise<{ bookingId: string }> }) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: false });
    if (refused) return new Response(refused.body, { headers: REQUESTER_HEADERS, status: refused.status });
    const requester = await openRequester(deps.db, (await context.params).bookingId);
    if (!requester) return requestUnavailable();
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) return requesterJson({ error: "Select a PNG, JPEG or WebP image." }, 415);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_CALENDAR_IMAGE_BYTES + 1024) return requesterJson({ error: "Use an image under 10 MB." }, 413);
    const form = await boundedFormData(request);
    if (form === "too_large") return requesterJson({ error: "Use an image under 10 MB." }, 413);
    const file = form?.get("image");
    if (!(file instanceof File)) return requesterJson({ error: "Select a calendar screenshot." }, 400);
    const timezone = form?.get("timezone");
    if (typeof timezone !== "string" || timezone.length > 64 || !isValidTimeZone(timezone)) return requesterJson({ error: "Choose a valid time zone before reading the screenshot." }, 400);
    if (file.size > MAX_CALENDAR_IMAGE_BYTES) return requesterJson({ error: "Use an image under 10 MB." }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateCalendarImage(bytes, file.type);
    if (validation.kind === "too_large") return requesterJson({ error: "Use an image under 10 MB." }, 413);
    if (validation.kind !== "valid") return requesterJson({ error: "Select a valid PNG, JPEG or WebP image." }, 415);
    if (!deps.extract) return requesterJson({ error: "Automatic reading is unavailable. Enter your free times manually." }, 503);
    try {
      await reserveCalendarOcr(deps.db, requester.id);
    } catch (cause) {
      if (cause instanceof ModelLimitError) return requesterJson({ error: "Screenshot reading is limited for this request right now. Enter your free times manually." }, 429);
      return requesterJson({ error: "Screenshot reading is unavailable. Enter your free times manually." }, 503);
    }
    try {
      const extracted = await deps.extract(bytes, validation.type!, timezone);
      const marks = z.array(markSchema).max(50).parse(extracted);
      return requesterJson({ marks });
    } catch {
      return requesterJson({ error: "The screenshot could not be read. Enter your free times manually." }, 503);
    }
  };
}
