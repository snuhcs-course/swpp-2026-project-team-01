// Which model serves each assistant (issue #375). A choice is a
// `provider/model` string, as AI Gateway writes model IDs, but it resolves to a
// direct provider through eve's helpers (design decision 5): `openai/...` uses
// OPENAI_API_KEY (and OPENAI_BASE_URL when set), `anthropic/...` uses
// ANTHROPIC_API_KEY. Gateway routing is not supported: limitModel needs a
// provider model instance, and Gateway calls carry no prompt cache key.
//
//   FMAT_ASSISTANT_MODEL  the conversation agent (agent/agent.ts), every audience
//   FMAT_RANKING_MODEL    the time ranking call (lib/server/evaluation.ts)
//
// Unset or empty, each keeps gpt-5.6-terra, so production changes only when an
// environment sets one. A malformed value or an unknown provider throws, so a
// typo fails the deployment's first call instead of quietly using the default.

export const MODEL_PROVIDERS = ["openai", "anthropic"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export type ModelChoice = {
  readonly provider: ModelProvider;
  // The provider's native model ID, such as gpt-5.6-terra or claude-sonnet-5-5.
  readonly modelId: string;
};

export const DEFAULT_ASSISTANT_MODEL = "openai/gpt-5.6-terra";
export const DEFAULT_RANKING_MODEL = "openai/gpt-5.6-terra";

export const ASSISTANT_MODEL_VARIABLE = "FMAT_ASSISTANT_MODEL";
export const RANKING_MODEL_VARIABLE = "FMAT_RANKING_MODEL";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function parseModelChoice(value: string): ModelChoice {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  const provider = trimmed.slice(0, slash);
  const modelId = trimmed.slice(slash + 1);

  if (slash <= 0 || !MODEL_ID.test(modelId)) {
    throw new Error(`Model choice "${value}" is not a provider/model string such as ${DEFAULT_ASSISTANT_MODEL}.`);
  }
  if (!(MODEL_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`Model provider "${provider}" is not one of ${MODEL_PROVIDERS.join(", ")}.`);
  }

  return { modelId, provider: provider as ModelProvider };
}

export function formatModelChoice(choice: ModelChoice) {
  return `${choice.provider}/${choice.modelId}`;
}

type Environment = Readonly<Record<string, string | undefined>>;

function fromEnvironment(variable: string, fallback: string, env: Environment) {
  const value = env[variable]?.trim();
  return parseModelChoice(value ? value : fallback);
}

export function assistantModelChoice(env: Environment = process.env) {
  return fromEnvironment(ASSISTANT_MODEL_VARIABLE, DEFAULT_ASSISTANT_MODEL, env);
}

export function rankingModelChoice(env: Environment = process.env) {
  return fromEnvironment(RANKING_MODEL_VARIABLE, DEFAULT_RANKING_MODEL, env);
}
