import { defineAgent } from 'eve';
import { openai } from 'eve/models/openai';
import { schedulingModel } from '../lib/server/model.ts';

const selected = schedulingModel();

export default defineAgent({
  model: openai(selected.id),
  modelContextWindowTokens: selected.contextWindowTokens,
  reasoning: 'low',
  defaultTools: false,
  tool: false,
  limits: { maxInputTokensPerSession: 100_000, maxOutputTokensPerSession: 8_000 },
});
