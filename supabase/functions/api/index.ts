import { readEnvironment } from '../_shared/env.ts';
import { createDatabase } from '../_shared/database.ts';
import { createApi } from './app.ts';
const environment = readEnvironment();
const app = createApi(environment, createDatabase(environment));
Deno.serve((request) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, '') || '/';
  return app.fetch(new Request(url, request));
});
