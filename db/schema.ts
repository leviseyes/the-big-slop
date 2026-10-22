import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const series = sqliteTable("series", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), name: text("name").notNull(),
  category: text("category").notNull(), data: text("data").notNull().default("{}"),
  created: integer("created").notNull(), updated: integer("updated").notNull(),
}, t => [index("idx_series_owner_updated").on(t.owner,t.updated)]);
export const seriesAssets = sqliteTable("series_assets", {
  seriesId: text("series_id").notNull().references(() => series.id),
  assetId: text("asset_id").notNull(), data: text("data").notNull(),
  sourceProject: text("source_project").notNull(), updated: integer("updated").notNull(),
}, t => [primaryKey({columns:[t.seriesId,t.assetId]})]);
export const productions = sqliteTable(
  "productions",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    category: text("category").notNull().default(""),
    seriesId: text("series_id").references(() => series.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    data: text("data").notNull(),
    version: integer("version").notNull().default(0),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [index("idx_productions_owner_updated").on(t.owner, t.updated),index("idx_productions_series_created").on(t.seriesId,t.created)],
);
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => productions.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    lease: text("lease"),
    leaseUntil: integer("lease_until").notNull().default(0),
    created: integer("created").notNull(),
  },
  (t) => [
    index("idx_jobs_status_created").on(t.status, t.created),
    uniqueIndex("idx_jobs_production_kind").on(t.projectId, t.kind),
  ],
);
export const payments = sqliteTable(
  "payments",
  {
    sessionId: text("session_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => productions.id),
    owner: text("owner").notNull(),
    amount: integer("amount").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [uniqueIndex("idx_payments_project").on(t.projectId)],
);
export const runtime = sqliteTable("runtime", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Uploaded films are separate from AI productions; only reviewed uploads enter The Pros.
export const proVideos = sqliteTable("pro_videos", {
  id: text("id").primaryKey(), owner: text("owner").notNull(),
  title: text("title").notNull(), description: text("description").notNull(),
  category: text("category").notNull(), creator: text("creator").notNull(),
  status: text("status").notNull().default("uploading"),
  mediaKey: text("media_key").notNull(), uploadId: text("upload_id").notNull(),
  contentType: text("content_type").notNull(), bytes: integer("bytes").notNull(),
  duration: integer("duration").notNull(),
  reviewNote: text("review_note").notNull().default(""), reviewedBy: text("reviewed_by"),
  created: integer("created").notNull(), updated: integer("updated").notNull(),
}, t => [index("idx_pro_videos_status_created").on(t.status,t.created), index("idx_pro_videos_owner_created").on(t.owner,t.created)]);
export const proVideoParts = sqliteTable("pro_video_parts", {
  videoId: text("video_id").notNull().references(() => proVideos.id),
  partNumber: integer("part_number").notNull(), etag: text("etag").notNull(), bytes: integer("bytes").notNull(),
}, t => [primaryKey({columns:[t.videoId,t.partNumber]})]);
