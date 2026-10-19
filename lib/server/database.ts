import postgres from "postgres";

// Domain code reaches Postgres through the Supabase transaction pooler as the
// owner of the private `app` schema. The pooler forbids prepared statements, and
// session state is only ever set inside a transaction.
export type Database = postgres.Sql;
export type Transaction = postgres.TransactionSql;
export type Queryable = Database | Transaction;

let client: Database | undefined;

export function createDatabase(url: string) {
  return postgres(url, { prepare: false });
}

export function database() {
  if (!client) {
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new Error("DATABASE_URL is not set.");
    }

    client = createDatabase(url);
  }

  return client;
}
