CREATE TABLE "public"."contacts" (
  "owner_id"   text   NOT NULL,
  "contact_id" text   NOT NULL,
  "created_at" bigint NOT NULL,
  CONSTRAINT "contacts_check" CHECK ((owner_id <> contact_id)),
  CONSTRAINT "contacts_pkey" PRIMARY KEY (owner_id, contact_id)
);

ALTER TABLE "public"."contacts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."contacts" FROM "anon", "authenticated";

ALTER TABLE "public"."users"
  ADD COLUMN "invite_token" text;

ALTER TABLE "public"."contacts"
  ADD CONSTRAINT "contacts_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."contacts"
  ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_invite_token_key" UNIQUE (invite_token);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."contacts" TO "postgres", "service_role";
