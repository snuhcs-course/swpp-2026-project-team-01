// `npm run admin -- <show|suspend|restore> ...`: the administrator CLI,
// fmat-admin. A separate entry point from the web and agent services; the logic
// lives in lib/server/operator.ts. Run it without arguments for usage.
import { createInterface } from "node:readline/promises";
import { runAdmin } from "../lib/server/operator";

async function prompt(question: string) {
  const reader = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return await reader.question(question);
  } finally {
    reader.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runAdmin(process.argv.slice(2), {
    env: process.env,
    interactive: process.stdin.isTTY === true,
    prompt,
    stderr: (line) => console.error(line),
    stdout: (line) => console.log(line),
  });
}
