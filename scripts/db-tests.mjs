// AI-generated with Codex, 2026-10-05 (Asia/Seoul).
import { spawnSync } from 'node:child_process';
const result = spawnSync('supabase', ['test', 'db'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
