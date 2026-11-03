export const MAX_CALENDAR_IMAGE_BYTES = 10 * 1024 * 1024;

export type ScreenshotMark = {
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly interpretation: "busy" | "free" | "unknown";
};
