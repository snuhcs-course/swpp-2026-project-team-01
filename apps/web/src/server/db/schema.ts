import { boolean, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core"

// Typed access for the original MVP tables. The newer tables (profiles, operations, calendars, searches...) are read and written
// with raw SQL (./sql.ts). Everything is defined in supabase/schemas/scheduler.sql, which this file must mirror.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

export const availabilityRules = pgTable(
  "availability_rules",
  {
    userId: text("user_id").notNull(),
    weekday: integer("weekday").notNull(),
    enabled: boolean("enabled").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekday] })],
)

export const places = pgTable("places", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull(),
  kind: text("kind", { enum: ["office_near", "special", "online"] }).notNull(),
  name: text("name").notNull(),
  revision: integer("revision").notNull().default(0),
  active: integer("active").notNull().default(1),
})

export const meetingTypes = pgTable("meeting_types", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  revision: integer("revision").notNull().default(0),
  active: integer("active").notNull().default(1),
})

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  locationKind: text("location_kind", { enum: ["office", "place", "online", "none"] }).notNull(),
  placeRef: text("place_ref"),
  source: text("source", { enum: ["seed", "manual", "booking"] }).notNull(),
  requestId: text("request_id"),
  revision: integer("revision").notNull().default(0),
})

// The original chat API (/api/conversations) rides on the per-visit booking search tables.
export const conversations = pgTable("booking_searches", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  hostId: text("host_id").notNull(),
  filterJson: text("overrides_json").notNull(),
})

export const messages = pgTable("search_messages", {
  id: text("id").primaryKey(),
  conversationId: text("search_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  optionsJson: text("options_json"),
  createdAt: text("created_at").notNull(),
})

export const requests = pgTable("requests", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  hostId: text("host_id").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  placeId: text("place_id").notNull(),
  meetingTypeId: text("meeting_type_id").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: ["pending", "accepted", "declined", "withdrawn"] }).notNull(),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  revision: integer("revision").notNull().default(0),
  searchId: text("search_id"),
  durationMinSnapshot: integer("duration_min_snapshot"),
  meetingTypeNameSnapshot: text("meeting_type_name_snapshot"),
  placeSnapshotJson: text("place_snapshot_json"),
  definitionState: text("definition_state").notNull().default("unconfirmed"),
})
