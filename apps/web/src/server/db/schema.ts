import { boolean, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core"

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
})

export const meetingTypes = pgTable("meeting_types", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
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
})

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    hostId: text("host_id").notNull(),
    filterJson: text("filter_json").notNull(),
  },
  (t) => [unique().on(t.clientId, t.hostId)],
)

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
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
})
