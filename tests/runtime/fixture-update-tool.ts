import { defineTool } from 'eve/tools';
import { writeFile, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { detailsUpdateInput } from '../../lib/contracts/conversation-tools.ts';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

// Fault injection after the actual production operation commits but before eve
// checkpoints its result. This module is copied only into the isolated fixture.
export default defineTool({
  description: 'Fixture update with a controlled post-commit interruption.', inputSchema: detailsUpdateInput,
  async execute(input, ctx) {
    const result = await new ConversationTools().execute(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId }, { operation: 'details_update', input });
    const marker = process.env.FMAT_TEST_MARKER;
    if (marker) {
      await writeFile(marker, 'committed');
      while (true) {
        try { await access(marker+'.release'); break; } catch { await delay(50); }
      }
    }
    return result;
  },
});
