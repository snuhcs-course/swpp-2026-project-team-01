import { filterChips, slotLabel, type Chip } from "@/core/chips"
import { diffChips, selectionBasis } from "@/core/explain"
import { mergeFilter, rankSlots } from "@/core/filter"
import { decideOptions } from "@/core/options"
import { summarize } from "@/core/summary"
import type { Filter, FilterKey, MeetingType, Place } from "@/core/types"
import { interpret, type HistoryMessage } from "@/llm/interpret"
import type { ChatClient } from "@/llm/ollama"
import { respond } from "@/llm/respond"
import type { Db } from "../db/client"
import { logEvent, roundMs } from "../log"
import {
  addMessage,
  getConversation,
  listMessages,
  saveFilter,
  type MessageView,
  type OptionView,
} from "../repos/conversations"
import { computeBookable } from "./schedule"

export interface ConversationState {
  conversationId: string
  hostId: string
  filter: Filter
  chips: Chip[]
  count: number
  messages: MessageView[]
}

export interface TurnResult {
  userMessage: MessageView
  assistantMessage: MessageView
  filter: Filter
  chips: Chip[]
  count: number
  options: OptionView[] | null
  /** True when the model's output was unusable twice: the filter was left unchanged. The UI shows a banner. */
  interpretFailed: boolean
  /** True when the LLM service could not be reached (either call). The UI shows a different banner. */
  llmUnavailable: boolean
}

export interface FilterResult {
  filter: Filter
  chips: Chip[]
  count: number
  options: OptionView[] | null
}

export class ChatError extends Error {
  constructor(readonly code: "not_found" | "not_bookable", message: string) {
    super(message)
  }
}

function toOptions(top: { slot: { startMs: number; placeId: string; meetingTypeId: string } }[], places: Place[], types: MeetingType[]): OptionView[] {
  return top.map(({ slot }) => ({
    startMs: slot.startMs,
    placeId: slot.placeId,
    meetingTypeId: slot.meetingTypeId,
    label: slotLabel(slot, places, types),
  }))
}

function sameOptions(a: OptionView[], b: OptionView[]): boolean {
  const key = (o: OptionView) => `${o.startMs}|${o.placeId}|${o.meetingTypeId}`
  return a.length === b.length && a.every((o, i) => key(o) === key(b[i]))
}

async function requireConversation(db: Db, conversationId: string, clientId: string) {
  const conv = await getConversation(db, conversationId)
  if (!conv || conv.clientId !== clientId) throw new ChatError("not_found", "대화를 찾을 수 없어요")
  return conv
}

export async function conversationState(db: Db, conversationId: string, clientId: string, nowMs: number): Promise<ConversationState> {
  const conv = await requireConversation(db, conversationId, clientId)
  const { slots, places, meetingTypes } = await computeBookable(db, clientId, conv.hostId, nowMs)
  return {
    conversationId,
    hostId: conv.hostId,
    filter: conv.filter,
    chips: filterChips(conv.filter, places, meetingTypes),
    count: rankSlots(slots, conv.filter).length,
    messages: await listMessages(db, conversationId),
  }
}

/** One conversation turn: ① interpret → apply and rank in code → ② respond. */
export async function runTurn(
  db: Db,
  llm: ChatClient,
  input: { conversationId: string; clientId: string; text: string },
  nowMs: number,
): Promise<TurnResult> {
  const conv = await requireConversation(db, input.conversationId, input.clientId)
  const { slots, places, meetingTypes } = await computeBookable(db, input.clientId, conv.hostId, nowMs)
  if (places.length === 0 || meetingTypes.length === 0) throw new ChatError("not_bookable", "이 호스트는 아직 예약을 받을 수 없어요")

  const started = performance.now()
  const previous = await listMessages(db, conv.id)
  const lastShown = [...previous].reverse().find((m) => m.role === "assistant" && m.options)?.options ?? null
  const userMessage = await addMessage(db, conv.id, "user", input.text, null)
  const history: HistoryMessage[] = [...previous, userMessage].map((m) => ({ role: m.role, content: m.content }))

  const interpreted = await interpret(llm, { nowMs, places, meetingTypes, filter: conv.filter, history, lastShown: lastShown ?? undefined })
  const filter = mergeFilter(conv.filter, interpreted.change)
  await saveFilter(db, conv.id, filter)

  const ranked = rankSlots(slots, filter)
  const summary = summarize(ranked, filter, slots)
  const decision = decideOptions(ranked, filter, interpreted.showOptions)
  const chipsBefore = filterChips(conv.filter, places, meetingTypes)
  const chips = filterChips(filter, places, meetingTypes)
  const changes = diffChips(chipsBefore, chips)

  // Buttons identical to the ones already on screen are not repeated unless the user asked for them.
  const proposed = decision.show ? toOptions(decision.top, places, meetingTypes) : null
  const sameAsBefore = !!proposed && !!lastShown && sameOptions(proposed, lastShown)
  const options = sameAsBefore && decision.reason !== "requested" ? null : proposed
  const basis = options
    ? selectionBasis({ top: decision.top, ranked, filter, chips, label: (r) => slotLabel(r.slot, places, meetingTypes) })
    : null
  const askMeetingType = !options && !sameAsBefore && ranked.length > 0 && !filter.meetingTypes && meetingTypes.length > 1

  const reply = await respond(llm, {
    nowMs,
    places,
    meetingTypes,
    filter,
    summary,
    optionsShown: options !== null,
    interpretFailed: interpreted.failure === "unparseable",
    llmUnavailable: interpreted.failure === "unavailable",
    askMeetingType,
    changes,
    basis,
    sameAsBefore,
    history,
  })
  const assistantMessage = await addMessage(db, conv.id, "assistant", reply.text, options)
  const llmUnavailable = interpreted.failure === "unavailable" || reply.unavailable

  logEvent("chat.turn", {
    conversationId: conv.id,
    hostId: conv.hostId,
    model: (llm as { model?: string }).model,
    interpret: {
      ms: roundMs(interpreted.ms),
      attempts: interpreted.attempts,
      failure: interpreted.failure,
      set: Object.keys(interpreted.change.set ?? {}),
      remove: interpreted.change.remove ?? [],
      showOptions: interpreted.showOptions,
    },
    respond: { ms: roundMs(reply.ms), fallback: reply.fallback },
    count: ranked.length,
    buttons: options ? decision.reason : null,
    sameAsBefore,
    askMeetingType,
    totalMs: roundMs(performance.now() - started),
  })

  return {
    userMessage,
    assistantMessage,
    filter,
    chips,
    count: ranked.length,
    options,
    interpretFailed: interpreted.failure === "unparseable",
    llmUnavailable,
  }
}

/** Chip removal: no LLM involved, only re-application of the remaining filter. */
export async function removeFilterKey(db: Db, conversationId: string, clientId: string, key: FilterKey, nowMs: number): Promise<FilterResult> {
  const conv = await requireConversation(db, conversationId, clientId)
  const filter = mergeFilter(conv.filter, { remove: [key] })
  await saveFilter(db, conv.id, filter)
  const { slots, places, meetingTypes } = await computeBookable(db, clientId, conv.hostId, nowMs)
  const ranked = rankSlots(slots, filter)
  const decision = decideOptions(ranked, filter, false)
  logEvent("chat.filter_removed", { conversationId: conv.id, key, count: ranked.length })
  return {
    filter,
    chips: filterChips(filter, places, meetingTypes),
    count: ranked.length,
    options: decision.show ? toOptions(decision.top, places, meetingTypes) : null,
  }
}
