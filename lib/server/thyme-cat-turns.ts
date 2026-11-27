// The cat a messenger turn ends with (thyme-mood-cats D7): the same rule the
// guest's web conversation applies to its messages, read from the session's
// recorded events instead of the browser's message parts. Each turn with
// visible text is one Thyme message; its tool results are the action.result
// events of the same turnId. Only a guest's Telegram reply uses it.

import type { MessageStreamEvent } from "eve/client";
import { type CatPart, catsOfThread, SHOW_CAT_TOOL, type ThymeCat } from "../contracts/thyme-cat";

type TurnEvent = { readonly turnId?: string; readonly finishReason?: string; readonly message?: string; readonly status?: string; readonly result?: unknown };

type ToolResult = { readonly kind?: string; readonly toolName?: string; readonly isError?: boolean; readonly output?: unknown };

// A tool output is an object or its JSON text.
function outputOf(output: unknown) {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return output;
  }
}

// One action.result as the part the web reads: failed is output-error; a call
// the host or a policy rejected never ran, so it is no part at all.
function partOf(data: TurnEvent): CatPart | null {
  const result = (data.result ?? {}) as ToolResult;
  if (result.kind !== "tool-result" || typeof result.toolName !== "string" || data.status === "rejected") return null;
  const output = outputOf(result.output);
  const failed = data.status === "failed" || result.isError === true;
  const shown = output && typeof output === "object" ? (output as { shown?: unknown }).shown : undefined;
  return {
    output,
    state: failed ? "output-error" : "output-available",
    toolName: result.toolName,
    type: "dynamic-tool",
    ...(result.toolName === SHOW_CAT_TOOL ? { input: { cat: shown } } : {}),
  };
}

export function turnCat(events: readonly MessageStreamEvent[], deliveryIds: readonly string[]): ThymeCat | null {
  const owned = new Set(deliveryIds);
  const turns = new Map<string, { parts: CatPart[]; visible: boolean; owned: boolean }>();

  for (const event of events) {
    const data = (event.data ?? {}) as TurnEvent;
    if (typeof data.turnId !== "string") continue;
    if (event.type !== "action.result" && event.type !== "message.completed") continue;
    let turn = turns.get(data.turnId);
    if (!turn) {
      turn = { owned: false, parts: [], visible: false };
      turns.set(data.turnId, turn);
    }
    if (event.meta.deliveryIds?.some((id) => owned.has(id))) turn.owned = true;
    if (event.type === "message.completed") {
      if (data.finishReason !== "tool-calls" && typeof data.message === "string" && data.message.trim()) turn.visible = true;
    } else {
      const part = partOf(data);
      if (part) turn.parts.push(part);
    }
  }

  const messages = [...turns.values()].filter((turn) => turn.visible);
  const cats = catsOfThread(messages.map((turn) => ({ parts: turn.parts, role: "assistant" })));
  const last = messages.findLastIndex((turn) => turn.owned);
  return last === -1 ? null : (cats[last] ?? null);
}
