// `npm run perf:check -- --origin <url> [--handle <handle>] [--samples 20]`: the
// pre-release latency check (operations-and-release design 3, D4). It sends
// sequential GET requests to the public routes, times each to its response
// headers, and compares p50 and p95 per route with TARGETS. Sequential requests
// from one machine include cold starts and the network, so the bounds are loose
// on purpose. It reads only public pages, sends no credential, and exits 1 when
// a route misses a target or fails. The targets it cannot measure are printed as
// not measured, never as passing.
import { parseArgs } from "node:util";

export const TARGETS = { p50Ms: 800, p95Ms: 2_000 } as const;

export const UNMEASURED = [
  "approval to confirmed booking within 2 minutes at p95",
  "a guest's first streamed reply within 10 seconds at p95",
] as const;

// The nearest-rank percentile of a non-empty list of durations.
export function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) throw new Error("No samples.");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1]!;
}

export type RouteResult = {
  readonly path: string;
  readonly p50: number;
  readonly p95: number;
  readonly failures: number;
  readonly passed: boolean;
};

export function judge(path: string, durations: readonly number[], failures: number): RouteResult {
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  return { failures, p50, p95, passed: failures === 0 && p50 <= TARGETS.p50Ms && p95 <= TARGETS.p95Ms, path };
}

export function routesFor(handle: string | undefined) {
  return ["/", "/SKILL.md", "/llms.txt", "/eve/v1/health", ...(handle ? [`/${handle}`] : [])];
}

async function timeOnce(url: string) {
  const started = performance.now();
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const elapsed = performance.now() - started;
  await response.body?.cancel();
  return { elapsed, ok: response.status === 200 };
}

export async function runPerfCheck(options: { readonly origin: string; readonly handle?: string; readonly samples: number; readonly log: (line: string) => void }) {
  const results: RouteResult[] = [];

  for (const path of routesFor(options.handle)) {
    const durations: number[] = [];
    let failures = 0;

    for (let index = 0; index < options.samples; index += 1) {
      try {
        const { elapsed, ok } = await timeOnce(new URL(path, options.origin).toString());
        durations.push(elapsed);
        if (!ok) failures += 1;
      } catch {
        failures += 1;
        durations.push(15_000);
      }
    }

    const result = judge(path, durations, failures);
    results.push(result);
    options.log(
      `${result.passed ? "pass" : "MISS"}  ${path}  p50 ${Math.round(result.p50)} ms  p95 ${Math.round(result.p95)} ms${failures > 0 ? `  ${failures} failed` : ""}`,
    );
  }

  options.log(`Targets: p50 at most ${TARGETS.p50Ms} ms and p95 at most ${TARGETS.p95Ms} ms per route over ${options.samples} sequential samples.`);
  for (const target of UNMEASURED) options.log(`Not measured: ${target}`);

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { handle: { type: "string" }, origin: { type: "string" }, samples: { type: "string" } },
    strict: true,
  });
  const origin = values.origin ? new URL(values.origin).origin : null;
  const samples = Number(values.samples ?? "20");

  if (!origin || !Number.isInteger(samples) || samples < 1 || samples > 200) {
    console.error("Usage: npm run perf:check -- --origin <url> [--handle <handle>] [--samples 1-200]");
    process.exitCode = 2;
  } else {
    console.log(`Origin: ${origin}`);
    const results = await runPerfCheck({ handle: values.handle, log: (line) => console.log(line), origin, samples });
    process.exitCode = results.every((result) => result.passed) ? 0 : 1;
  }
}
