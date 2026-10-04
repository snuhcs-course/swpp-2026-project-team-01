CREATE TABLE "public"."meeting_requests" (
  "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "share_link_id"         uuid                     NOT NULL,
  "requester_calendar_id" uuid                     NOT NULL,
  "requester_name"        text                     NOT NULL,
  "requester_email"       text                     NOT NULL,
  "purpose"               text                     NOT NULL,
  "duration_minutes"      integer                  NOT NULL,
  "location"              text                     NOT NULL DEFAULT ''::text,
  "candidate_slots"       jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "status"                text                     NOT NULL DEFAULT 'needs_owner_review'::text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "meeting_requests_duration_minutes_check" CHECK ((duration_minutes = ANY (ARRAY[30, 45, 60, 90]))),
  CONSTRAINT "meeting_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "meeting_requests_status_check" CHECK ((status = ANY (ARRAY['needs_owner_review'::text, 'approved'::text, 'declined'::text])))
);

ALTER TABLE "public"."meeting_requests"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."meeting_requests" FROM "anon", "authenticated";

CREATE TABLE "public"."owner_calendars" (
  "google_sub"              text                     NOT NULL,
  "email"                   text                     NOT NULL,
  "encrypted_refresh_token" text                     NOT NULL,
  "connected_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "owner_calendars_pkey" PRIMARY KEY (google_sub)
);

ALTER TABLE "public"."owner_calendars"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."owner_calendars" FROM "anon", "authenticated";

CREATE TABLE "public"."requester_calendars" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "share_link_id"           uuid                     NOT NULL,
  "google_sub"              text                     NOT NULL,
  "email"                   text                     NOT NULL,
  "encrypted_refresh_token" text                     NOT NULL,
  "connected_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "requester_calendars_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_calendars_share_link_id_google_sub_key" UNIQUE (share_link_id, google_sub)
);

ALTER TABLE "public"."requester_calendars"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."requester_calendars" FROM "anon", "authenticated";

CREATE TABLE "public"."share_links" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code_hash"        text                     NOT NULL,
  "owner_google_sub" text                     NOT NULL,
  "active"           boolean                  NOT NULL DEFAULT true,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "share_links_code_hash_key" UNIQUE (code_hash),
  CONSTRAINT "share_links_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."share_links"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."share_links" FROM "anon", "authenticated";

ALTER TABLE "public"."meeting_requests"
  ADD CONSTRAINT "meeting_requests_requester_calendar_id_fkey" FOREIGN KEY (requester_calendar_id) REFERENCES public.requester_calendars(id) ON DELETE RESTRICT;

ALTER TABLE "public"."share_links"
  ADD CONSTRAINT "share_links_owner_google_sub_fkey" FOREIGN KEY (owner_google_sub) REFERENCES public.owner_calendars(google_sub) ON DELETE CASCADE;

ALTER TABLE "public"."meeting_requests"
  ADD CONSTRAINT "meeting_requests_share_link_id_fkey" FOREIGN KEY (share_link_id) REFERENCES public.share_links(id) ON DELETE CASCADE;

ALTER TABLE "public"."requester_calendars"
  ADD CONSTRAINT "requester_calendars_share_link_id_fkey" FOREIGN KEY (share_link_id) REFERENCES public.share_links(id) ON DELETE CASCADE;

CREATE INDEX meeting_requests_link_created_idx ON public.meeting_requests USING btree (share_link_id, created_at DESC);

CREATE INDEX requester_calendars_link_idx ON public.requester_calendars USING btree (share_link_id);

CREATE INDEX share_links_owner_created_idx ON public.share_links USING btree (owner_google_sub, created_at DESC);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."meeting_requests" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."owner_calendars" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."requester_calendars" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."share_links" TO "postgres", "service_role";
