#!/usr/bin/env node
// AI-generated with Codex, 2026-10-05 (Asia/Seoul).

import { createServer } from "node:http";
import path from "node:path";
import { ROOT } from "./agentmail-probe-lib.mjs";
import { createReceiver } from "./agentmail-paired-webhook-lib.mjs";

const directory = path.join(ROOT, ".local/p0-agentmail/distinct-paired-webhook");
const receive = createReceiver(directory);
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"probe":"p0-agentmail-paired"}');
    return;
  }
  if (request.method !== "POST" || request.url !== "/webhooks") {
    response.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 65_536) {
        response.writeHead(413).end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const headers = Object.fromEntries(
      ["svix-id", "svix-timestamp", "svix-signature"].map((name) => [name, request.headers[name]]),
    );
    const result = await receive(Buffer.concat(chunks), headers);
    response.writeHead(result.status).end();
    console.log(JSON.stringify({ status: result.status, outcome: result.outcome }));
  } catch {
    response.writeHead(503).end();
    console.error("paired receiver persistence failed");
  }
});
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(8790, "127.0.0.1", () =>
  console.log("P0 paired receiver on 127.0.0.1:8790"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close());
