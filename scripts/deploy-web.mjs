import { spawnSync } from 'node:child_process';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Missing public Supabase configuration');
const args = [
  'deploy', '--prod', '--yes', '--scope', 'justdodos-projects',
  '--build-env', `VITE_SUPABASE_URL=${process.env.SUPABASE_URL}`,
  '--build-env', `VITE_SUPABASE_PUBLISHABLE_KEY=${process.env.SUPABASE_PUBLISHABLE_KEY}`
];
const result = spawnSync('vercel', args, { cwd: '.', stdio: 'inherit' });
process.exit(result.status ?? 1);
