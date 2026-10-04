import { createCandidateRanker } from './ranking.ts';
import type { Environment } from '../env.ts';
const env = { openaiKey: 'synthetic', openaiModel: 'gpt-4o-mini-2024-07-18' } as Environment;
const candidates = [{ start: '2030-06-01T09:00:00Z', end: '2030-06-01T09:30:00Z' }, {
  start: '2030-06-01T10:00:00Z',
  end: '2030-06-01T10:30:00Z',
}];
function fetcher(candidateIds: unknown, capture?: (body: string) => void): typeof fetch {
  return ((_url: string, init: RequestInit) => {
    capture?.(String(init.body));
    return Promise.resolve(
      Response.json({ choices: [{ message: { content: JSON.stringify({ candidateIds }) } }] }),
    );
  }) as typeof fetch;
}
Deno.test('private ranking accepts only a complete permutation of feasible candidate IDs', async () => {
  const ranked = await createCandidateRanker(env, fetcher(['candidate_1', 'candidate_0']))(
    candidates,
    'Prefer later',
  );
  if (ranked[0] !== candidates[1] || ranked[1] !== candidates[0]) {
    throw new Error('Valid order lost');
  }
  for (
    const ids of [['candidate_2', 'candidate_0'], ['candidate_0', 'candidate_0'], ['candidate_1']]
  ) {
    if (
      await createCandidateRanker(env, fetcher(ids))(candidates, 'Override checks') !== candidates
    ) throw new Error('Invented or incomplete candidate order accepted');
  }
});
Deno.test('ranking receives no identity, physical location, calendar or authority context', async () => {
  let body = '';
  await createCandidateRanker(
    env,
    fetcher(['candidate_0', 'candidate_1'], (value) => body = value),
  )(candidates, 'Prefer later');
  const payload = JSON.parse(body);
  const context = JSON.parse(payload.messages[1].content);
  if (
    Object.keys(context).sort().join(',') !== 'candidates,preferences' ||
    Object.keys(context.candidates[0]).sort().join(',') !== 'end,id,start'
  ) throw new Error('Unexpected ranking context');
});
