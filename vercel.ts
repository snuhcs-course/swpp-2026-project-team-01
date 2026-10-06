import { withEve } from 'eve/vercel';

export default await withEve({
  services: {
    web: {
      framework: 'nextjs',
      root: 'apps/web',
      buildCommand: 'node ../../node_modules/next/dist/bin/next build',
    },
  },
  routes: [
    { src: '^/api/internal/conversations/dispatch$', destination: { type: 'service', service: 'eve' } },
    { src: '^/api/conversations(?:/.*)?$', destination: { type: 'service', service: 'eve' } },
    { src: '^(.*)$', destination: { type: 'service', service: 'web' } },
  ],
});
