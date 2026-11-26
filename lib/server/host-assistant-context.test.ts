import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { assistantText, eligibleMemory, memoryNotice, memorySchema, questionSchema, recalledContext, type ContextEntry } from "./host-assistant-context";
import { accountMemoryScope } from "../../agent/memory/account";
import { accountTools } from "../../agent/lib/account-tools";

vi.mock("./database", () => ({ database: () => ({}) }));
vi.mock("./channel-selection", async importOriginal => ({ ...await importOriginal<typeof import("./channel-selection")>(), linkedMessagingTurn: async () => ({ inputId: "input", message: "[Telegram] hi", channel: "telegram" }) }));
const memory: ContextEntry = { kind: "memory", entry_key: "one", revision: 1, content: { text: "avoid Friday afternoons", category: "soft_preference", expiresAt: null }, confirmed: true, operation_id: "save-one", source_input_id: "input-one" };

describe("private account context", () => {
  it("remembers only eligible verbatim host words, never guest or calendar data or rules", () => {
    expect(eligibleMemory("avoid Friday afternoons", "[Telegram] I tend to avoid Friday afternoons", [])).toBe(true);
    expect(eligibleMemory("prefers morning", "[Telegram] Hello", [])).toBe(false);
    expect(eligibleMemory("Eunwoo is my priority", "Eunwoo is my priority", ["Eunwoo"])).toBe(false);
    expect(eligibleMemory("Budget review matters", "Budget review matters", ["Budget review"])).toBe(false);
    for (const text of ["always decline Fridays", "절대 금요일 예약 잡지 마", "me@example.test", "a\nb"]) expect(eligibleMemory(text, text, [])).toBe(false);
  });
  it("requires an expiry for dated life context and a target for request questions", () => {
    expect(memorySchema.safeParse({ text: "exams until December", category: "life_context", expiresAt: null }).success).toBe(false);
    expect(memorySchema.safeParse({ text: "exams until December", category: "life_context", expiresAt: "2026-12-16T00:00:00Z" }).success).toBe(true);
    expect(questionSchema.safeParse({ question: "Approve it?", ref: null, direction: "received", version: 1, expectedRevision: 2 }).success).toBe(false);
  });
  it("does not recall staged/forgotten records and returns empty replacements", () => {
    expect(recalledContext([memory]).memories).toEqual([memory]);
    expect(recalledContext([{ ...memory, confirmed: false }]).memories).toEqual([]);
    expect(recalledContext([])).toEqual({ ledger: [], memories: [], questionRevision: 0 });
    expect(recalledContext([{ ...memory, kind: "question", entry_key: "latest", content: {}, revision: 3, confirmed: false }])).toEqual({ ledger: [], memories: [], questionRevision: 3 });
  });
  it("creates a one-line save notice and reads only the final assistant reply for acknowledgement", () => {
    expect(memoryNotice("avoid Fridays", true)).toBe("기억해 둘게요: avoid Fridays");
    expect(memoryNotice("avoid Fridays", false)).toBe("I'll remember: avoid Fridays");
    expect(assistantText([{ role: "assistant", content: "old acknowledgement" }, { role: "user", content: "Forget it" }, { role: "assistant", content: [{ type: "text", text: "Forgotten" }] }])).toBe("Forgotten");
  });
  it("never enables the provider for requester, intake, legacy-review or unauthenticated sessions", async () => {
    const context = (audience: string) => ({ abortSignal: new AbortController().signal, channel: {}, session: { id: "session", auth: { current: { authenticator: "test", principalType: "user", principalId: "owner", attributes: { audience } }, initiator: null } } });
    expect(await accountMemoryScope(context("host_setup"))).toBe("owner");
    for (const audience of ["requester", "public_intake", "host_review"]) expect(await accountMemoryScope(context(audience))).toBeNull();
    expect(await accountMemoryScope({ ...context("host_setup"), session: { id: "session", auth: { current: null, initiator: null } } })).toBeNull();
    expect(Object.keys(accountTools())).not.toContain("switch_conversation");
  });
  it("keeps authored tool filenames from shadowing Eve's derived memory tool resolvers", () => {
    const slots = readdirSync(new URL("../../agent/memory/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => name.slice(0, -3));
    const authored = readdirSync(new URL("../../agent/tools/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => name.slice(0, -3));
    expect(authored.filter(name => slots.includes(name))).toEqual([]);
  });
  it("keeps sample approval in the decision batch and reserves finish_sample_tutorial for change/end", () => {
    const schema = accountTools().finish_sample_tutorial.inputSchema;
    if (!(schema instanceof z.ZodObject)) throw new Error("Expected the authored sample-action schema");
    expect(schema.safeParse({ ref: "SAMPLE", action: "approve" }).success).toBe(false);
    expect(schema.safeParse({ ref: "SAMPLE", action: "decline" }).success).toBe(false);
    expect(schema.safeParse({ ref: "SAMPLE", action: "change" }).success).toBe(true);
    expect(schema.safeParse({ ref: "SAMPLE", action: "end" }).success).toBe(true);
  });
  it("declares private FK/RLS boundaries, expiry and replay tombstones without changing the active-binding constraint", () => {
    const schema = readFileSync(new URL("../../supabase/schemas/app/tables/host_assistant_context.sql", import.meta.url), "utf8");
    expect(schema).toContain('REFERENCES "app"."host_accounts" ("id") ON DELETE CASCADE');
    expect(schema).toContain('ENABLE ROW LEVEL SECURITY');
    expect(schema).toContain('FROM PUBLIC, anon, authenticated');
    expect(schema).toContain('"revision" > 0');
    expect(schema).toContain('"forgotten_at" IS NULL OR "content"');
    const bindings = readFileSync(new URL("../../supabase/schemas/app/tables/imessage_bindings.sql", import.meta.url), "utf8");
    expect(bindings).not.toContain("selected_request_id");
    expect(bindings).toContain('ON "app"."imessage_bindings" ("host_account_id") WHERE "state" = \'active\'');
  });
});
