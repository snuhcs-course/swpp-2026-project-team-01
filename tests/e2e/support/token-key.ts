import { randomBytes } from "node:crypto";

// The token encryption key of one browser-test run, shared by the web server
// Playwright starts and the test process, so a Calendar grant a test seals is
// one the app can open. The runner evaluates the config first and sets the key
// in its environment; the workers it forks inherit that environment, so they
// read the same key when they evaluate the config again. A new run gets a new
// key, which also starts the sign-up source bound afresh (its counted sources
// are hashed under this key). playwright.config.ts loads this file, so it
// imports nothing from the application.
process.env.E2E_TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");

export const E2E_TOKEN_ENCRYPTION_KEY = process.env.E2E_TOKEN_ENCRYPTION_KEY;
