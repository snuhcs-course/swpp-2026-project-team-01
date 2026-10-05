import { createServer } from "node:http";
import { resolve } from "node:path";
import { createReceiver } from "./agentmail-webhook-lib.mjs";

const receive = createReceiver(resolve(".local/p0-agentmail"));
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"probe":"p0-agentmail"}');
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
      if (size > 65536) {
        response.writeHead(413).end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const headers = Object.fromEntries(
      ["svix-id", "svix-timestamp", "svix-signature"].map((name) => [
        name,
        request.headers[name],
      ]),
    );
    const result = await receive(Buffer.concat(chunks), headers);
    response.writeHead(result.status).end();
    console.log(
      JSON.stringify({ status: result.status, outcome: result.outcome }),
    );
  } catch {
    response.writeHead(503).end();
    console.error("private persistence failed");
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(8789, "127.0.0.1", () =>
  console.log("P0 fixture receiver on 127.0.0.1:8789"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close());
