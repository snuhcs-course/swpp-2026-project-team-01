import { requiredEnv } from './config.ts';
import { ApplicationError } from './errors.ts';

// Native Responses API model; update this verified metadata with model changes.
// https://developers.openai.com/api/docs/models/gpt-6-luna
export function schedulingModel(env = process.env) {
  const id = requiredEnv('OPENAI_MODEL', env);
  if (id !== 'gpt-6-luna') {
    throw new ApplicationError('CONFIGURATION_UNAVAILABLE', 503);
  }
  return { id, contextWindowTokens: 1_050_000 } as const;
}
