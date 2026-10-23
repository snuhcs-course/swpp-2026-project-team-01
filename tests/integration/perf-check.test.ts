import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { judge, percentile, routesFor, runPerfCheck, TARGETS } from "../../scripts/perf-check";

// The pre-release latency check (operations-and-release design 3, D4): its
// statistics, and a run against a local server that answers one route slowly
// and one with an error.

describe("perf check", () => {
  it("takes nearest-rank percentiles", () => {
    const values = Array.from({ length: 20 }, (_, index) => (index + 1) * 10);

    expect(percentile(values, 0.5)).toBe(100);
    expect(percentile(values, 0.95)).toBe(190);
    expect(percentile([5], 0.95)).toBe(5);
    expect(() => percentile([], 0.5)).toThrow();
  });

  it("passes a route only within both targets and without failures", () => {
    expect(judge("/", [100, 200, 300], 0).passed).toBe(true);
    expect(judge("/", [TARGETS.p50Ms + 1, TARGETS.p50Ms + 1, 10], 0).passed).toBe(false);
    expect(judge("/", [...Array(18).fill(10), TARGETS.p95Ms + 1, TARGETS.p95Ms + 1], 0).passed).toBe(false);
    expect(judge("/", [10, 10], 1).passed).toBe(false);
  });

  it("checks the public routes and the host page when a handle is given", () => {
    expect(routesFor(undefined)).toEqual(["/", "/SKILL.md", "/llms.txt", "/eve/v1/health"]);
    expect(routesFor("ada")).toContain("/ada");
  });

  it("reports a slow route and a failing route as misses and the unmeasured targets", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/llms.txt") {
        response.writeHead(500).end();
      } else if (request.url === "/SKILL.md") {
        setTimeout(() => response.writeHead(200).end("slow"), TARGETS.p50Ms + 100);
      } else {
        response.writeHead(200).end("ok");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const lines: string[] = [];

    try {
      const results = await runPerfCheck({ log: (line) => lines.push(line), origin: `http://127.0.0.1:${port}`, samples: 2 });

      expect(Object.fromEntries(results.map((result) => [result.path, result.passed]))).toEqual({
        "/": true,
        "/SKILL.md": false,
        "/eve/v1/health": true,
        "/llms.txt": false,
      });
      expect(lines.filter((line) => line.startsWith("Not measured:"))).toHaveLength(2);
    } finally {
      server.close();
    }
  });
});
