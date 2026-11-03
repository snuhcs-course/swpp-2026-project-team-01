import { describe, expect, it } from "vitest";
import { createOpenAiCalendarExtractor } from "./calendar-screenshot-openai";

function providerResponse(marks: unknown) {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ marks }) }] }],
  }), { headers: { "content-type": "application/json" } });
}

describe("OpenAI calendar screenshot extraction", () => {
  it("sends the image once without provider storage and returns only time marks", async () => {
    let sent: Record<string, unknown> = {};
    const request: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.openai.com/v1/responses");
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return providerResponse([{ date: "2026-11-09", start: "10:00", end: "11:00", interpretation: "free" }]);
    };
    const extract = createOpenAiCalendarExtractor({ apiKey: "test-key", request, now: () => new Date("2026-11-02T00:00:00Z") });
    const result = await extract(new Uint8Array([1, 2, 3]), "image/png", "Asia/Seoul");
    expect(result).toEqual([{ date: "2026-11-09", start: "10:00", end: "11:00", interpretation: "free" }]);
    expect(sent).toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "none" }, store: false, text: { format: { type: "json_schema", strict: true } } });
    const content = ((sent.input as { content: { type: string; image_url?: string; text?: string }[] }[])[0]!).content;
    expect(content[0]?.text).toContain("Asia/Seoul");
    expect(content[1]?.image_url).toBe("data:image/png;base64,AQID");
  });

  it("rejects an incomplete or failed provider response", async () => {
    const extract = createOpenAiCalendarExtractor({
      apiKey: "test-key",
      request: async () => new Response(JSON.stringify({ status: "incomplete", output: [] })),
    });
    await expect(extract(new Uint8Array([1]), "image/png", "UTC")).rejects.toThrow("did not complete");
  });
});
