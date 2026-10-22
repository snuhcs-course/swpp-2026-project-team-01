#!/usr/bin/env node
import { createInterface } from "node:readline";
import { main } from "./app.js";

// The fmat executable. Pasted login values are read from stdin one line at a time.
const lines = createInterface({ input: process.stdin, terminal: false });
const queue: string[] = [];
const waiting: ((line: string) => void)[] = [];
lines.on("line", (line) => {
  const next = waiting.shift();
  if (next) next(line);
  else queue.push(line);
});
lines.on("close", () => {
  for (const next of waiting.splice(0)) next("");
});

const code = await main(process.argv.slice(2), {
  env: process.env,
  readLine: () => (queue.length > 0 ? Promise.resolve(queue.shift()!) : new Promise((resolve) => waiting.push(resolve))),
  stderr: (text) => process.stderr.write(text),
  stdout: (text) => process.stdout.write(text),
});

lines.close();
process.exitCode = code;
