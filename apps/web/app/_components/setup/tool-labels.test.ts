import type { EveDynamicToolPart } from "eve/react";
import { describe, expect, it } from "vitest";
import { describeSetupTool } from "./tool-labels";

// How Thyme's setup tool calls read in the conversation.

function part(toolName: string, input: unknown, state = "output-available") {
  return { input, output: {}, state, toolCallId: "call", toolName, type: "dynamic-tool" } as unknown as EveDynamicToolPart;
}

describe("setup tool labels", () => {
  it("names a setup read as checking the setup", () => {
    expect(describeSetupTool(part("read_setup_state", {}))).toBe("Checked your setup");
    expect(describeSetupTool(part("read_setup_state", {}, "output-error"))).toBe("Couldn't check your setup");
  });

  it("names the drafted fields in the host's words", () => {
    expect(describeSetupTool(part("draft_settings", { values: { bufferBeforeMinutes: { source: "stated", value: 15 } } }))).toBe(
      "Drafted your buffer before",
    );
    expect(
      describeSetupTool(
        part("draft_settings", {
          values: {
            durationMinutes: { source: "stated", value: 30 },
            meetingMode: { source: "stated", value: "online" },
            timezone: { source: "stated", value: "Asia/Seoul" },
          },
        }),
      ),
    ).toBe("Drafted your meeting length, online or in person and time zone");
    expect(describeSetupTool(part("draft_settings", undefined))).toBe("Drafted your settings");
  });

  it("leaves other tools to their own labels", () => {
    expect(describeSetupTool(part("search", { query: "x" }))).toBeUndefined();
  });
});
