import { startFakeOpenAI } from "../../integration/support/fake-openai";

// The browser tests' model: a local Responses API stand-in on a fixed port, so
// the agent service started by Playwright never calls OpenAI.
const port = Number(process.env.FAKE_OPENAI_PORT ?? "3102");
const fake = await startFakeOpenAI(undefined, port);
console.log(`Fake OpenAI listening at ${fake.baseURL}`);
