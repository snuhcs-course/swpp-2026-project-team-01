import type { SetupFieldName } from "@lib/contracts/setup";
import type { EveDynamicToolPart } from "eve/react";
import { FIELD_LABELS } from "./format";

// How Thyme's setup tools read in the conversation: a short, friendly line in
// place of the tool's name ("Checked your setup", "Drafted your buffer before").

function toolName(part: EveDynamicToolPart) {
  const named = part.toolMetadata?.eve?.name;
  return named && named !== "unknown" ? named : part.toolName;
}

function joinLabels(labels: readonly string[]) {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export function describeSetupTool(part: EveDynamicToolPart): string | undefined {
  const failed = part.state === "output-error";
  switch (toolName(part)) {
    case "read_setup_state":
      return failed ? "Couldn't check your setup" : "Checked your setup";
    case "draft_settings": {
      const values = (part.input as { values?: Record<string, unknown> } | undefined)?.values;
      const fields = Object.keys(values ?? {}).filter((field): field is SetupFieldName => field in FIELD_LABELS);
      const what = fields.length > 0 ? `your ${joinLabels(fields.map((field) => FIELD_LABELS[field].toLowerCase()))}` : "your settings";
      return failed ? `Couldn't draft ${what}` : `Drafted ${what}`;
    }
    default:
      return undefined;
  }
}
