import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { defineDynamic } from "eve";
import { anthropic } from "eve/models/anthropic";
import { openai } from "eve/models/openai";
import { type ModelChoice, assistantModelChoice } from "./model-choice";
import { limitModel, sessionIdHash } from "./model-limits";

// The conversation agent's model fields for agent/agent.ts, from
// FMAT_ASSISTANT_MODEL (model-choice.ts). Every call passes the model limit
// middleware (design decision 6), which attributes a conversation call by the
// prompt cache key eve derives from the session ID.
//
// eve derives that key only for OpenAI. An OpenAI choice is therefore the static
// model as before, and production's default is unchanged. Any other provider is
// resolved before each model call (`step.started`), where the session ID is
// known, and gets the same key written into the call's options before the limit
// middleware reads them; the other provider ignores options under `openai`.

// Reasoning tokens count against the 4,096-token output cap; medium effort
// used about 120 of them on a scheduling question (measured 2026-10-19).
export const ASSISTANT_REASONING = "medium";
export const ASSISTANT_CONTEXT_WINDOW_TOKENS = 32_000;
const OPENAI_OPTIONS = { providerOptions: { openai: { serviceTier: "default", store: false } } };

export function providerModel(choice: ModelChoice): LanguageModel {
  return choice.provider === "openai" ? openai(choice.modelId) : anthropic(choice.modelId);
}

// Writes the session's prompt cache key into every call, as eve does for OpenAI.
export function sessionKeyMiddleware(sessionId: string): LanguageModelMiddleware {
  const key = sessionIdHash(sessionId);

  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => ({
      ...params,
      providerOptions: {
        ...params.providerOptions,
        openai: { ...params.providerOptions?.openai, promptCacheKey: key },
      },
    }),
  };
}

// The model a non-OpenAI choice uses for one call of a session: the key goes on
// outside the limit wrapper, so the wrapper sees it.
export function sessionModel(choice: ModelChoice, sessionId: string) {
  return wrapLanguageModel({ middleware: sessionKeyMiddleware(sessionId), model: limitModel(providerModel(choice)) });
}

export function assistantModelFields(choice: ModelChoice = assistantModelChoice()) {
  if (choice.provider === "openai") {
    return {
      model: limitModel(providerModel(choice)),
      modelContextWindowTokens: ASSISTANT_CONTEXT_WINDOW_TOKENS,
      modelOptions: OPENAI_OPTIONS,
    };
  }

  // A dynamic model sets its context window per selection, not beside it.
  return {
    model: defineDynamic({
      events: {
        "step.started": (_event: unknown, ctx: { readonly session: { readonly id: string } }) => ({
          model: sessionModel(choice, ctx.session.id),
          modelContextWindowTokens: ASSISTANT_CONTEXT_WINDOW_TOKENS,
        }),
      },
    }),
  };
}
