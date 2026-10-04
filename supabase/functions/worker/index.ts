import { readEnvironment } from '../_shared/env.ts';
import { createDatabase } from '../_shared/database.ts';
import { createWorker } from './app.ts';
const environment = readEnvironment();
Deno.serve(createWorker(environment, createDatabase(environment)));
