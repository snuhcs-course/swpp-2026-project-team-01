#!/usr/bin/env node
import { journeyFile, jsonFetch, readJson } from "./oauth-probe-lib.mjs";

const journeyIndex = process.argv.indexOf("--journey");
const journey = journeyIndex >= 0 ? process.argv[journeyIndex + 1] : "terminal";
const expectDenied = process.argv.includes("--expect-denied");
const state = await readJson(journeyFile(journey));
if (!state?.tokens?.refreshed_access_token)
  throw new Error("COMPLETED_REFRESHED_JOURNEY_REQUIRED");

const token = state.tokens.refreshed_access_token;
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const calls = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: `fmat-p0-${journey}-probe`, version: "1.0.0" },
    },
  },
  {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "diagnostic.read", arguments: {} },
  },
];
const results = [];
for (const body of calls) {
  const result = await jsonFetch(state.resource, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  results.push({
    method: body.method,
    httpStatus: result.response.status,
    body: result.body,
  });
  if (!result.response.ok) break;
}
console.log(
  JSON.stringify({ journey, resource: state.resource, results }, null, 2),
);
const statuses = results.map((result) => result.httpStatus);
process.exitCode = expectDenied
  ? statuses.at(-1) === 401 || statuses.at(-1) === 403
    ? 0
    : 1
  : statuses.every((status) => status === 200 || status === 204)
    ? 0
    : 1;
