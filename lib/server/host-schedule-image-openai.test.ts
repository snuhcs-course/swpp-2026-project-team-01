import { describe, expect, it } from "vitest";
import { createOpenAiWeeklyScheduleExtractor } from "./host-schedule-image-openai";

describe("host schedule image extraction", () => {
  it("sends the image without storage and returns only weekly time ranges", async () => {
    let body: Record<string, unknown> = {};
    const extract = createOpenAiWeeklyScheduleExtractor({
      apiKey: "test-key",
      request: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ windows: [{ weekday: "monday", start: "09:00", end: "12:00" }] }) }] }] });
      },
    });
    await expect(extract(new Uint8Array([1, 2, 3]), "image/png")).resolves.toEqual([{ weekday: "monday", start: "09:00", end: "12:00" }]);
    expect(body).toMatchObject({ model: "gpt-5.6-terra", store: false, text: { format: { type: "json_schema", strict: true } } });
    const content = ((body.input as { content: { text?: string; image_url?: string }[] }[])[0]!).content;
    expect(content[0]?.text).toContain("repeat every week");
    expect(content[1]?.image_url).toBe("data:image/png;base64,AQID");
  });
});
