CREATE TABLE "app"."google_identities" (
  "google_subject"  text                     NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "auth_user_id"    uuid                     NOT NULL,
  "email"           text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "google_identities_auth_user_id_key" UNIQUE (auth_user_id),
  CONSTRAINT "google_identities_host_account_id_key" UNIQUE (host_account_id),
  CONSTRAINT "google_identities_pkey" PRIMARY KEY (google_subject)
);

ALTER TABLE "app"."google_identities"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."host_accounts" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "status"     text                     NOT NULL DEFAULT 'active'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "host_accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "host_accounts_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);

ALTER TABLE "app"."host_accounts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."provider_grants" (
  "host_account_id"          uuid                     NOT NULL,
  "provider"                 text                     NOT NULL DEFAULT 'google'::text,
  "granted_scopes"           text[]                   NOT NULL DEFAULT '{}'::text[],
  "refresh_token_ciphertext" text,
  "refresh_token_key_id"     text,
  "scopes_checked_at"        timestamp with time zone,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "provider_grants_pkey" PRIMARY KEY (host_account_id),
  CONSTRAINT "provider_grants_provider_check" CHECK ((provider = 'google'::text)),
  CONSTRAINT "provider_grants_sealed_token" CHECK (((refresh_token_ciphertext IS NULL) = (refresh_token_key_id IS NULL)))
);

ALTER TABLE "app"."provider_grants"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."google_identities"
  ADD CONSTRAINT "google_identities_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "app"."google_identities"
  ADD CONSTRAINT "google_identities_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."provider_grants"
  ADD CONSTRAINT "provider_grants_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;
