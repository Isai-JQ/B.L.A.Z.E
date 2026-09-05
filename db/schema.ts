import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// RLS is enabled here (drizzle-kit push applies `enableRLS()` correctly), but the actual
// policies (USING/WITH CHECK expressions referencing auth.uid()) live in
// db/sql/001_auth_triggers.sql instead of as `pgPolicy(...)` below: drizzle-kit push
// silently drops policy expressions on tables it introspects (creates the policy but with
// a null qual, i.e. it blocks every row) — raw SQL is the only reliable way to apply them.

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    priorityTier: integer("priority_tier").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [],
).enableRLS();

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [],
).enableRLS();

export const printerStatus = pgEnum("printer_status", ["idle", "printing", "offline"]);

// T16b: RLS on, no policies — deny-all from the client. See db/sql/002_printers_rls.sql.
export const printers = pgTable("printers", {
  id: uuid("id").primaryKey().defaultRandom(),
  serialNumber: text("serial_number").notNull().unique(),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  accessCode: text("access_code").notNull(),
  status: printerStatus("status").notNull().default("offline"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}).enableRLS();

export const jobStatus = pgEnum("job_status", [
  "queued",
  "waiting",
  "assigned",
  "printing",
  "completed",
  "failed",
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userProfiles.id),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  printerId: uuid("printer_id").references(() => printers.id),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  status: jobStatus("status").notNull().default("queued"),
  manualRank: integer("manual_rank"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const notificationType = pgEnum("notification_type", ["job_failed", "job_waiting"]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => userProfiles.id),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  type: notificationType("type").notNull(),
  message: text("message").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
