import { defineAgent } from 'eve';
import { mockModel } from 'eve/evals';
import { randomUUID } from 'node:crypto';

// Dedicated test application only; never imported by the production agent.
export default defineAgent({
  defaultTools: false, tool: false, modelContextWindowTokens: 100_000,
  model: mockModel(({ lastUserMessage, userMessageCount, toolResults }) => {
    if (lastUserMessage?.startsWith('save:') && !toolResults.some(result => !result.isError &&
      (result.output as { details?: { purpose?: string } })?.details?.purpose === lastUserMessage)) {
      return { toolCalls: [{ id: randomUUID(), name: 'update_request_details', input: { expectedRevision: 1,
        details: { requesterName: '', requesterEmail: '', purpose: lastUserMessage, timezone: '', windows: [], mode: '', location: '' },
      } }] };
    }
    return `Reply ${userMessageCount}: ${lastUserMessage}`;
  }),
});
