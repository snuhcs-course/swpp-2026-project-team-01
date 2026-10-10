import assert from 'node:assert/strict';
import { generateText, tool } from 'ai';
import { openai } from 'eve/models/openai';
import { z } from 'zod';
import { requiredEnv } from '../lib/server/config.ts';
import { schedulingModel } from '../lib/server/model.ts';

// Opt-in live probe. No scheduling tools, private data or external effects.
try {
  requiredEnv('OPENAI_API_KEY');
  const model = schedulingModel();
  const result = await generateText({
    model: openai(model.id),
    prompt: 'Call validate_probe with status ready.',
    tools: { validate_probe: tool({
      description: 'Return the probe status. This tool performs no operation.',
      inputSchema: z.object({ status: z.literal('ready') }),
    }) },
    toolChoice: 'required',
    maxOutputTokens: 512,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30_000),
    providerOptions: { openai: { reasoningEffort: 'low', store: false } },
  });
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].toolName, 'validate_probe');
  assert.deepEqual(result.toolCalls[0].input, { status: 'ready' });
  console.log(JSON.stringify({ model: model.id, provider: 'direct OpenAI',
    structuredToolCall: 'passed', usage: result.usage }));
} catch (error) {
  // Provider error objects can include requests and credentials; print no body.
  console.error(JSON.stringify({ probe: 'failed', code: error.code ?? 'PROVIDER_UNAVAILABLE', status: error.statusCode ?? null }));
  process.exitCode = 1;
}
