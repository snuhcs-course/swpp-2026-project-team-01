
  create table "public"."availability_rules" (
    "user_id" text not null,
    "weekday" integer not null,
    "enabled" boolean not null,
    "start_min" integer not null,
    "end_min" integer not null
      );


alter table "public"."availability_rules" enable row level security;


  create table "public"."conversations" (
    "id" text not null,
    "client_id" text not null,
    "host_id" text not null,
    "filter_json" text not null
      );


alter table "public"."conversations" enable row level security;


  create table "public"."events" (
    "id" text not null,
    "user_id" text not null,
    "title" text not null,
    "start_at" text not null,
    "end_at" text not null,
    "location_kind" text not null,
    "place_ref" text,
    "source" text not null,
    "request_id" text
      );


alter table "public"."events" enable row level security;


  create table "public"."meeting_types" (
    "id" text not null,
    "host_id" text not null,
    "name" text not null,
    "duration_min" integer not null
      );


alter table "public"."meeting_types" enable row level security;


  create table "public"."messages" (
    "id" text not null,
    "conversation_id" text not null,
    "role" text not null,
    "content" text not null,
    "options_json" text,
    "created_at" text not null
      );


alter table "public"."messages" enable row level security;


  create table "public"."places" (
    "id" text not null,
    "host_id" text not null,
    "kind" text not null,
    "name" text not null
      );


alter table "public"."places" enable row level security;


  create table "public"."requests" (
    "id" text not null,
    "client_id" text not null,
    "host_id" text not null,
    "start_at" text not null,
    "end_at" text not null,
    "place_id" text not null,
    "meeting_type_id" text not null,
    "message" text not null,
    "status" text not null,
    "created_at" text not null,
    "decided_at" text
      );


alter table "public"."requests" enable row level security;


  create table "public"."users" (
    "id" text not null,
    "name" text not null
      );


alter table "public"."users" enable row level security;

CREATE UNIQUE INDEX availability_rules_pkey ON public.availability_rules USING btree (user_id, weekday);

CREATE UNIQUE INDEX conversations_client_id_host_id_key ON public.conversations USING btree (client_id, host_id);

CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id);

CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);

CREATE INDEX events_user_start ON public.events USING btree (user_id, start_at);

CREATE UNIQUE INDEX meeting_types_pkey ON public.meeting_types USING btree (id);

CREATE INDEX messages_conv ON public.messages USING btree (conversation_id, created_at);

CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id);

CREATE UNIQUE INDEX places_pkey ON public.places USING btree (id);

CREATE UNIQUE INDEX requests_pkey ON public.requests USING btree (id);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);

alter table "public"."availability_rules" add constraint "availability_rules_pkey" PRIMARY KEY using index "availability_rules_pkey";

alter table "public"."conversations" add constraint "conversations_pkey" PRIMARY KEY using index "conversations_pkey";

alter table "public"."events" add constraint "events_pkey" PRIMARY KEY using index "events_pkey";

alter table "public"."meeting_types" add constraint "meeting_types_pkey" PRIMARY KEY using index "meeting_types_pkey";

alter table "public"."messages" add constraint "messages_pkey" PRIMARY KEY using index "messages_pkey";

alter table "public"."places" add constraint "places_pkey" PRIMARY KEY using index "places_pkey";

alter table "public"."requests" add constraint "requests_pkey" PRIMARY KEY using index "requests_pkey";

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "public"."conversations" add constraint "conversations_client_id_host_id_key" UNIQUE using index "conversations_client_id_host_id_key";

grant delete on table "public"."availability_rules" to "service_role";

grant insert on table "public"."availability_rules" to "service_role";

grant references on table "public"."availability_rules" to "service_role";

grant select on table "public"."availability_rules" to "service_role";

grant trigger on table "public"."availability_rules" to "service_role";

grant truncate on table "public"."availability_rules" to "service_role";

grant update on table "public"."availability_rules" to "service_role";

grant delete on table "public"."conversations" to "service_role";

grant insert on table "public"."conversations" to "service_role";

grant references on table "public"."conversations" to "service_role";

grant select on table "public"."conversations" to "service_role";

grant trigger on table "public"."conversations" to "service_role";

grant truncate on table "public"."conversations" to "service_role";

grant update on table "public"."conversations" to "service_role";

grant delete on table "public"."events" to "service_role";

grant insert on table "public"."events" to "service_role";

grant references on table "public"."events" to "service_role";

grant select on table "public"."events" to "service_role";

grant trigger on table "public"."events" to "service_role";

grant truncate on table "public"."events" to "service_role";

grant update on table "public"."events" to "service_role";

grant delete on table "public"."meeting_types" to "service_role";

grant insert on table "public"."meeting_types" to "service_role";

grant references on table "public"."meeting_types" to "service_role";

grant select on table "public"."meeting_types" to "service_role";

grant trigger on table "public"."meeting_types" to "service_role";

grant truncate on table "public"."meeting_types" to "service_role";

grant update on table "public"."meeting_types" to "service_role";

grant delete on table "public"."messages" to "service_role";

grant insert on table "public"."messages" to "service_role";

grant references on table "public"."messages" to "service_role";

grant select on table "public"."messages" to "service_role";

grant trigger on table "public"."messages" to "service_role";

grant truncate on table "public"."messages" to "service_role";

grant update on table "public"."messages" to "service_role";

grant delete on table "public"."places" to "service_role";

grant insert on table "public"."places" to "service_role";

grant references on table "public"."places" to "service_role";

grant select on table "public"."places" to "service_role";

grant trigger on table "public"."places" to "service_role";

grant truncate on table "public"."places" to "service_role";

grant update on table "public"."places" to "service_role";

grant delete on table "public"."requests" to "service_role";

grant insert on table "public"."requests" to "service_role";

grant references on table "public"."requests" to "service_role";

grant select on table "public"."requests" to "service_role";

grant trigger on table "public"."requests" to "service_role";

grant truncate on table "public"."requests" to "service_role";

grant update on table "public"."requests" to "service_role";

grant delete on table "public"."users" to "service_role";

grant insert on table "public"."users" to "service_role";

grant references on table "public"."users" to "service_role";

grant select on table "public"."users" to "service_role";

grant trigger on table "public"."users" to "service_role";

grant truncate on table "public"."users" to "service_role";

grant update on table "public"."users" to "service_role";


-- Added by hand: migra omits this for new tables, but Supabase's default privileges grant
-- anon/authenticated on create table. Mirrors the revoke in supabase/schemas/scheduler.sql.
revoke all on table "public"."users", "public"."availability_rules", "public"."places", "public"."meeting_types", "public"."events", "public"."conversations", "public"."messages", "public"."requests" from "anon", "authenticated";
