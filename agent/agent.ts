import { defineAgent } from 'eve';
import { openai } from 'eve/models/openai';
import { schedulingModel } from '../lib/server/model.ts';
import { conversationModel } from '../lib/server/models/conversation.ts';

const selected = schedulingModel();

export default defineAgent({
  model: conversationModel(openai(selected.id), selected.contextWindowTokens),
  reasoning: 'low',
  defaultTools: false,
  tool: false,
  limits: { maxInputTokensPerSession: 100_000, maxOutputTokensPerSession: 8_000 },
});
