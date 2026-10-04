import { readEnvironment } from '../_shared/env.ts';
import { createDatabase } from '../_shared/database.ts';
import { createWorker } from './app.ts';
import { createDeliveryHandler } from '../_shared/modules/delivery/contact.ts';
const environment = readEnvironment();
const database = createDatabase(environment);
const deliver = createDeliveryHandler(environment, database);
Deno.serve(createWorker(environment, database, { contact_delivery: deliver, delivery: deliver }));
