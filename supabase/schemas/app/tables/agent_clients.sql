-- Personal-agent OAuth clients (agent-access design 3). The ID is fmat-cli for
-- the first-party CLI, dcr_... for a dynamically registered client, or the
-- https URL of a client ID metadata document, whose fetched redirect URIs are
-- cached until metadata_expires_at. Registration grants nothing: a client acts
-- only through a grant a person allowed. registration_source_hash is the keyed
-- hash of the registering address, for the registration bounds.
CREATE TABLE "app"."agent_clients" (
  "id" text PRIMARY KEY CHECK (char_length("id") BETWEEN 1 AND 2000),
  "kind" text NOT NULL CHECK ("kind" IN ('first_party', 'registered', 'metadata_document')),
  "client_name" text NOT NULL CHECK (char_length("client_name") BETWEEN 1 AND 200),
  "client_uri" text CHECK (char_length("client_uri") <= 2000),
  "redirect_uris" text[] NOT NULL CHECK (cardinality("redirect_uris") BETWEEN 1 AND 10),
  "registration_source_hash" text,
  "metadata_fetched_at" timestamptz,
  "metadata_expires_at" timestamptz,
  "disabled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_clients_metadata_cache" CHECK (
    ("kind" = 'metadata_document') = ("metadata_expires_at" IS NOT NULL)
  )
);

ALTER TABLE "app"."agent_clients" ENABLE ROW LEVEL SECURITY;
