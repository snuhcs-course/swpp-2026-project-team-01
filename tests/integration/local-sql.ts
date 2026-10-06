import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Deliberately use only the disposable Supabase Docker container. No linked
// project, environment secret, remote database URL, or remote reset is used.
export class LocalSql {
  private readonly child: ChildProcessWithoutNullStreams;
  private output = '';
  private errors = '';
  private pending?: { marker: string; resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private closed = false;

  constructor() {
    const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([a-zA-Z0-9_-]+)"$/mu)?.[1];
    if (!project) throw new Error('Local Supabase project ID is required');
    this.child = spawn('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
    this.child.stdout.on('data', chunk => {
      this.output += chunk.toString();
      const pending = this.pending;
      if (!pending) return;
      const index = this.output.indexOf(pending.marker);
      if (index < 0) return;
      const value = this.output.slice(0, index).trim();
      this.output = this.output.slice(index + pending.marker.length).trimStart();
      clearTimeout(pending.timer); this.pending = undefined; pending.resolve(value);
    });
    this.child.stderr.on('data', chunk => { this.errors += chunk.toString(); });
    this.child.on('error', error => this.fail(error));
    this.child.on('close', code => { this.closed = true; this.fail(new Error(`Local SQL exited (${code}): ${this.errors}`)); });
  }

  private fail(error: Error) {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
  }
  query(sql: string): Promise<string> {
    if (this.pending || this.closed) return Promise.reject(new Error('Local SQL connection is busy or closed'));
    return new Promise((resolve, reject) => {
      const marker = `done_${randomUUID()}`;
      const timer = setTimeout(() => { this.fail(new Error('Local SQL query timed out')); this.close(); }, 10_000);
      this.pending = { marker, resolve, reject, timer };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  close() { this.child.stdin.end(); }
}
