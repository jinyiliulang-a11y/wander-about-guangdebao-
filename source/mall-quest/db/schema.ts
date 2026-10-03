import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey().notNull(), requestId: text("request_id"), requestHash: text("request_hash").notNull(),
  username: text("username").notNull(), role: text("role").notNull(), passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(), passwordIterations: integer("password_iterations").notNull(),
  playerId: text("player_id").notNull().references(() => players.id), storeId: text("store_id").references(() => stores.id),
  nickname: text("nickname").notNull(), phone: text("phone"), email:text("email"),merchantJson: text("merchant_json"), status: text("status").notNull(),
  reviewNote: text("review_note").notNull().default(""), reviewToken: text("review_token"), revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [uniqueIndex("uq_accounts_role_username").on(t.role,t.username), uniqueIndex("uq_accounts_request").on(t.requestId),
  uniqueIndex("uq_accounts_role_email").on(t.role,t.email).where(sql`${t.email} IS NOT NULL`),
  uniqueIndex("uq_accounts_player").on(t.playerId), index("idx_account_application_status").on(t.status,t.createdAt),
  check("account_role", sql`${t.role} IN ('player','merchant','admin')`), check("account_status", sql`${t.status} IN ('pending','approved','rejected')`),
  check("account_password_iterations",sql`${t.passwordIterations} BETWEEN 10000 AND 100000`),
  check("account_password_lengths",sql`length(${t.passwordSalt})=32 AND length(${t.passwordHash})=64`),
  check("account_username_length",sql`length(${t.username}) BETWEEN 3 AND 254`),check("account_revision",sql`${t.revision}>=1`),
  check("account_review_note_length",sql`length(${t.reviewNote})<=160`),
  check("account_email",sql`${t.email} IS NULL OR (length(${t.email}) BETWEEN 3 AND 254 AND ${t.email}=lower(${t.email}) AND instr(${t.email},'@')>1)`),
  check("account_merchant_details",sql`(${t.role}='merchant' AND ${t.merchantJson} IS NOT NULL) OR (${t.role}<>'merchant' AND ${t.merchantJson} IS NULL)`),
  check("account_merchant_approved_store",sql`(${t.role}='merchant' AND ${t.status}='approved' AND ${t.storeId} IS NOT NULL) OR (${t.status}<>'approved' OR ${t.role}<>'merchant')`),
]);
export const accountRateLimits = sqliteTable("account_rate_limits", {
  key: text("key").primaryKey().notNull(), windowStartedAt: integer("window_started_at").notNull(), attemptCount: integer("attempt_count").notNull(),
}, t => [check("account_rate_count", sql`${t.attemptCount}>=1`)]);
export const emailChallenges=sqliteTable("email_challenges",{
  id:text("id").primaryKey().notNull(),role:text("role").notNull(),email:text("email").notNull(),purpose:text("purpose").notNull(),
  codeHash:text("code_hash").notNull(),sendStatus:text("send_status").notNull(),createdAt:integer("created_at").notNull(),
  expiresAt:integer("expires_at").notNull(),attempts:integer("attempts").notNull().default(0),consumedAt:integer("consumed_at"),consumeToken:text("consume_token"),
},t=>[index("idx_email_challenge_subject").on(t.role,t.email,t.createdAt),check("email_challenge_role",sql`${t.role} IN ('player','merchant','admin')`),
  check("email_challenge_email",sql`length(${t.email}) BETWEEN 3 AND 254 AND ${t.email}=lower(${t.email}) AND instr(${t.email},'@')>1`),
  check("email_challenge_purpose",sql`${t.purpose} IN ('login','register','bind')`),check("email_challenge_hash",sql`length(${t.codeHash})=64`),
  check("email_challenge_send_status",sql`${t.sendStatus} IN ('pending','sent','failed')`),check("email_challenge_lifetime",sql`${t.expiresAt}>${t.createdAt}`),
  check("email_challenge_attempts",sql`${t.attempts} BETWEEN 0 AND 5`),check("email_challenge_consume_pair",sql`(${t.consumedAt} IS NULL)=(${t.consumeToken} IS NULL)`)]);

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  nickname: text("nickname").notNull(),
  createdAt: integer("created_at").notNull(),
  phone: text("phone"),
  avatar: text("avatar").notNull().default("🧭"),
  banned: integer("banned",{mode:"boolean"}).notNull().default(false),
  pointsBalance: integer("points_balance").notNull().default(0),
},t=>[uniqueIndex("uq_player_phone").on(t.phone).where(sql`${t.phone} IS NOT NULL`),check("player_points_nonnegative",sql`${t.pointsBalance}>=0`)]);
export const stores = sqliteTable(
  "stores",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    floor: text("floor").notNull(),
    area: text("area").notNull(),
    category: text("category").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    codeHash: text("code_hash").notNull(),
    pointMode: text("point_mode").notNull().default("static"),
    rewardTitle: text("reward_title").notNull(),
    conditions: text("conditions").notNull(),
    stockTotal: integer("stock_total").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    artwork: integer("artwork").notNull(),
    imageURL: text("image_url").notNull().default(""),
    imageRevision: integer("image_revision").notNull().default(0),
    logo:text("logo").notNull().default("🏪"),
    address:text("address").notNull().default(""),
    phone:text("phone").notNull().default(""),
    status:text("status").notNull().default("active"),
  },
  (t) => [check("store_stock_nonnegative", sql`${t.stockTotal} >= 0`), check("store_point_mode", sql`${t.pointMode} IN ('static','hardware')`)],
);
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => players.id),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    title: text("title").notNull(),
    clues: text("clues").notNull(),
    status: text("status").notNull(),
    reviewNote: text("review_note").notNull().default(""),
    isFeatured: integer("is_featured", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    question:text("question"),answer:text("answer"),difficulty:integer("difficulty").notNull().default(3),
    expiresAt:integer("expires_at"),rewardType:text("reward_type").notNull().default("coupon"),rewardValue:integer("reward_value").notNull().default(50),
    rewardCouponId:text("reward_coupon_id"),photoURLs:text("photo_urls").notNull().default('["","","","",""]'),
    deletedAt:integer("deleted_at"),
    nfcClaim:integer("nfc_claim",{mode:"boolean"}).notNull().default(false),
  },
  (t) => [
    index("idx_tasks_status").on(t.status),
    check("task_nfc_claim",sql`${t.nfcClaim} IN (0,1)`),
    check(
      "task_valid_status",
      sql`${t.status} IN ('pending','published','rejected','offline')`,
    ),
  ],
);
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  role: text("role").notNull(),
  playerId: text("player_id").references(() => players.id),
  storeId: text("store_id").references(() => stores.id),
  expiresAt: integer("expires_at").notNull(),
  accountId: text("account_id").references(() => accounts.id),
  legacyAuthenticated: integer("legacy_authenticated", { mode: "boolean" }).notNull().default(false),
});
export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
    eventId: text("event_id").notNull(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    couponCode: text("coupon_code").notNull(),
    issuedAt: integer("issued_at").notNull(),
    redeemedAt: integer("redeemed_at"),
    nfcRequestHash:text("nfc_request_hash"),
    rewardType:text("reward_type").notNull().default("coupon"),rewardValue:integer("reward_value").notNull().default(50),templateId:text("template_id"),
    rewardSnapshot:text("reward_snapshot").notNull().default(""),conditionsSnapshot:text("conditions_snapshot").notNull().default(""),storeNameSnapshot:text("store_name_snapshot").notNull().default(""),
    couponType:text("coupon_type").notNull().default("gift"),couponValue:real("coupon_value").notNull().default(0),couponMinAmount:real("coupon_min_amount").notNull().default(0),
    validStart:integer("valid_start"),validEnd:integer("valid_end"),
  },
  (t) => [
    uniqueIndex("uq_claim_player_event_store").on(
      t.playerId,
      t.eventId,
      t.storeId,
    ),
    uniqueIndex("uq_coupon_code").on(t.couponCode),
    index("idx_claim_store").on(t.storeId),
    index("idx_claim_task").on(t.taskId),
    check("claim_nfc_request_hash",sql`${t.nfcRequestHash} IS NULL OR length(${t.nfcRequestHash})=64`),
  ],
);
export const nfcClaimDrafts = sqliteTable("nfc_claim_drafts", {
  id: text("id").primaryKey().notNull(), requestHash: text("request_hash").notNull(),
  playerId: text("player_id").notNull().references(() => players.id), playerAccountId: text("player_account_id").notNull().references(() => accounts.id),
  playerSessionHash: text("player_session_hash").notNull(), eventId: text("event_id").notNull(),
  storeId: text("store_id").notNull().references(() => stores.id), taskId: text("task_id").notNull().references(() => tasks.id),
  deviceId: text("device_id").notNull().references(() => hardwareDevices.id), deviceTokenHash: text("device_token_hash").notNull(),
  state: text("state").notNull().default("pending"), revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), permitUntil: integer("permit_until").notNull(),
  locationTimestamp: integer("location_timestamp").notNull(), fenceRevision: integer("fence_revision").notNull(),
  taskTitleSnapshot: text("task_title_snapshot").notNull(), storeNameSnapshot: text("store_name_snapshot").notNull(),
  rewardType: text("reward_type").notNull(), rewardValue: integer("reward_value").notNull(), templateId: text("template_id"),
  rewardSnapshot: text("reward_snapshot").notNull(), conditionsSnapshot: text("conditions_snapshot").notNull(),
  couponType: text("coupon_type").notNull(), couponValue: real("coupon_value").notNull(), couponMinAmount: real("coupon_min_amount").notNull(),
  validStart: integer("valid_start"), validEnd: integer("valid_end"), claimId: text("claim_id").references(() => claims.id),
  couponCode: text("coupon_code"), merchantAccountId: text("merchant_account_id").references(() => accounts.id), deviceReturnedAt: integer("device_returned_at"),
  lastRequestId: text("last_request_id").notNull(), lastRequestHash: text("last_request_hash").notNull(), lastPurpose: text("last_purpose").notNull(),
  lastActorAccountId: text("last_actor_account_id").notNull().references(() => accounts.id),
}, t => [uniqueIndex("uq_nfc_pending_player_store").on(t.playerId,t.eventId,t.storeId).where(sql`${t.state}='pending'`),
  index("idx_nfc_draft_player").on(t.playerId,t.eventId,t.state,t.createdAt,t.id),
  index("idx_nfc_draft_device").on(t.storeId,t.deviceId,t.eventId,t.state,t.createdAt,t.id),
  check("nfc_draft_request_hash",sql`length(${t.requestHash})=64`), check("nfc_draft_last_hash",sql`length(${t.lastRequestHash})=64`),
  check("nfc_draft_state",sql`${t.state} IN ('pending','deleted','issued')`),check("nfc_draft_event",sql`${t.eventId}='mall-48h'`),
  check("nfc_draft_revision",sql`${t.revision}>=1`),check("nfc_draft_fence_revision",sql`${t.fenceRevision}>=1`),
  check("nfc_draft_reward_type",sql`${t.rewardType} IN ('coupon','points')`),
  check("nfc_draft_last_purpose",sql`${t.lastPurpose} IN ('create','revalidate','delete','issue')`),
  check("nfc_draft_issued_pair",sql`(${t.state}='issued' AND ${t.claimId} IS NOT NULL AND ${t.couponCode} IS NOT NULL AND ${t.merchantAccountId} IS NOT NULL AND ${t.deviceReturnedAt} IS NOT NULL)
    OR (${t.state}<>'issued' AND ${t.claimId} IS NULL AND ${t.couponCode} IS NULL AND ${t.merchantAccountId} IS NULL AND ${t.deviceReturnedAt} IS NULL)`)]);
export const nfcDraftOperations = sqliteTable("nfc_draft_operations", {
  requestId: text("request_id").primaryKey().notNull(), draftId: text("draft_id").notNull().references(() => nfcClaimDrafts.id),
  purpose: text("purpose").notNull(), actorAccountId: text("actor_account_id").notNull().references(() => accounts.id),
  requestHash: text("request_hash").notNull(), resultRevision: integer("result_revision").notNull(), createdAt: integer("created_at").notNull(),
}, t => [index("idx_nfc_operation_draft").on(t.draftId,t.purpose),check("nfc_operation_hash",sql`length(${t.requestHash})=64`),
  check("nfc_operation_revision",sql`${t.resultRevision}>=1`),check("nfc_operation_purpose",sql`${t.purpose} IN ('create','revalidate','delete','issue')`)]);

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    clarity: integer("clarity").notNull(),
    comment: text("comment").notNull(),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [uniqueIndex("uq_feedback_player_task").on(t.playerId, t.taskId)],
);

export const recordingCoupons=sqliteTable("recording_coupons",{
  id:text("id").primaryKey().notNull(),playerId:text("player_id").notNull().references(()=>players.id),
  eventId:text("event_id").notNull(),storeId:text("store_id").notNull().references(()=>stores.id),
  couponCode:text("coupon_code").notNull(),storeNameSnapshot:text("store_name_snapshot").notNull(),
  rewardSnapshot:text("reward_snapshot").notNull(),conditionsSnapshot:text("conditions_snapshot").notNull(),artwork:integer("artwork").notNull(),
  issuedAt:integer("issued_at").notNull(),validEnd:integer("valid_end").notNull(),redeemedAt:integer("redeemed_at"),
},t=>[uniqueIndex("uq_recording_coupon_code").on(t.couponCode),index("idx_recording_coupon_player").on(t.eventId,t.playerId,t.issuedAt),
  index("idx_recording_coupon_store").on(t.eventId,t.storeId,t.issuedAt),check("recording_coupon_scope",sql`${t.storeId}='tea' AND ${t.eventId}='mall-48h'`),
  check("recording_coupon_code",sql`length(${t.couponCode})=26 AND substr(${t.couponCode},1,6)='GTB-D-' AND substr(${t.couponCode},7) NOT GLOB '*[^0-9A-F]*'`),
  check("recording_coupon_lifetime",sql`${t.validEnd}>${t.issuedAt}`),check("recording_coupon_redemption",sql`${t.redeemedAt} IS NULL OR ${t.redeemedAt}>=${t.issuedAt}`)]);
export const recordingCouponRequests=sqliteTable("recording_coupon_requests",{
  requestId:text("request_id").primaryKey().notNull(),playerId:text("player_id").notNull().references(()=>players.id),
  couponId:text("coupon_id").notNull().references(()=>recordingCoupons.id),createdAt:integer("created_at").notNull(),
});

export const taskReviews = sqliteTable(
  "task_reviews",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    reviewerId: text("reviewer_id").notNull(),
    action: text("action").notNull(),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_task_reviews_task_time").on(t.taskId, t.createdAt),
    check(
      "review_valid_action",
      sql`${t.action} IN ('published','rejected','offline','featured','unfeatured')`,
    ),
  ],
);

export const hardwareDevices = sqliteTable("hardware_devices", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id),
  tokenHash: text("token_hash").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
  boundTaskId:text("bound_task_id").references(()=>tasks.id),
}, (t) => [index("idx_hardware_device_store").on(t.storeId), check("hardware_enabled_boolean", sql`${t.enabled} IN (0,1)`)]);

export const hardwareCodes = sqliteTable("hardware_codes", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull().references(() => hardwareDevices.id),
  storeId: text("store_id").notNull().references(() => stores.id),
  requestId: text("request_id").notNull(),
  nonce: text("nonce").notNull(),
  codeHash: text("code_hash").notNull(),
  authHash: text("auth_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedBy: text("used_by").references(() => players.id),
  claimId: text("claim_id").references(() => claims.id),
}, (t) => [uniqueIndex("uq_hardware_request").on(t.deviceId, t.requestId), index("idx_hardware_code_store").on(t.storeId, t.codeHash), check("hardware_positive_lifetime", sql`${t.expiresAt}>${t.createdAt}`), check("hardware_use_pair", sql`(${t.usedBy} IS NULL AND ${t.claimId} IS NULL) OR (${t.usedBy} IS NOT NULL AND ${t.claimId} IS NOT NULL)`)]);

export const hardwareClaimAttempts = sqliteTable("hardware_claim_attempts", {
  playerId: text("player_id").notNull().references(() => players.id),
  storeId: text("store_id").notNull().references(() => stores.id),
  windowStartedAt: integer("window_started_at").notNull(),
  attemptCount: integer("attempt_count").notNull(),
}, (t) => [uniqueIndex("uq_hardware_attempt_player_store").on(t.playerId, t.storeId), check("hardware_attempt_nonnegative", sql`${t.attemptCount}>=0`)]);

export const gameSettings=sqliteTable("game_settings",{
  id:text("id").primaryKey(),dailyLimit:integer("daily_limit").notNull(),clueCosts:text("clue_costs").notNull(),
  contributionRatio:real("contribution_ratio").notNull(),ugcReview:integer("ugc_review",{mode:"boolean"}).notNull(),updatedAt:integer("updated_at").notNull(),
});
export const storeGeofences = sqliteTable("store_geofences", {
  storeId: text("store_id").primaryKey().notNull().references(() => stores.id),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  latitude: real("latitude"), longitude: real("longitude"), radiusMeters: real("radius_meters"),
  shapeType: text("shape_type", { enum: ["circle", "polygon"] }).notNull().default("circle"),
  polygonJson: text("polygon_json"),
  revision: integer("revision").notNull().default(1), updatedAt: integer("updated_at").notNull(),
}, t => [
  check("geofence_enabled_boolean", sql`${t.enabled} IN (0,1)`),
  check("geofence_revision_positive", sql`${t.revision}>=1`),
  check("geofence_center_pair", sql`(${t.latitude} IS NULL)=(${t.longitude} IS NULL)`),
  check("geofence_latitude_range", sql`${t.latitude} IS NULL OR (${t.latitude}>=-90 AND ${t.latitude}<=90)`),
  check("geofence_longitude_range", sql`${t.longitude} IS NULL OR (${t.longitude}>=-180 AND ${t.longitude}<=180)`),
  check("geofence_radius_range", sql`${t.radiusMeters} IS NULL OR (${t.radiusMeters}>=20 AND ${t.radiusMeters}<=5000)`),
  check("geofence_enabled_center", sql`${t.enabled}=0 OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.radiusMeters} IS NOT NULL)`),
  check("geofence_shape_type", sql`${t.shapeType} IN ('circle','polygon')`),
  check("geofence_polygon_shape", sql`(${t.shapeType}='circle' AND ${t.polygonJson} IS NULL)
   OR (${t.shapeType}='polygon' AND ${t.polygonJson} IS NOT NULL AND CASE
    WHEN length(${t.polygonJson})<=16384 AND json_valid(${t.polygonJson})
    THEN json_type(${t.polygonJson})='array' AND json_array_length(${t.polygonJson}) BETWEEN 3 AND 64 ELSE 0 END)`),
]);
export const couponTemplates=sqliteTable("coupon_templates",{
  id:text("id").primaryKey(),storeId:text("store_id").notNull().references(()=>stores.id),title:text("title").notNull(),type:text("type").notNull(),
  value:real("value").notNull(),minAmount:real("min_amount").notNull(),totalCount:integer("total_count").notNull(),
  validStart:integer("valid_start"),validEnd:integer("valid_end"),status:text("status").notNull(),createdAt:integer("created_at").notNull(),updatedAt:integer("updated_at").notNull(),
  deletedAt:integer("deleted_at"),
});
export const playerActivity=sqliteTable("player_activity",{
  playerId:text("player_id").notNull().references(()=>players.id),day:text("day").notNull(),
  firstSeenAt:integer("first_seen_at").notNull(),
},t=>[primaryKey({columns:[t.playerId,t.day]}),index("idx_activity_day").on(t.day)]);
export const pointsLedger=sqliteTable("points_ledger",{
  id:text("id").primaryKey(),playerId:text("player_id").notNull().references(()=>players.id),delta:integer("delta").notNull(),
  kind:text("kind").notNull(),sourceId:text("source_id").notNull(),reason:text("reason").notNull(),createdAt:integer("created_at").notNull(),
},t=>[uniqueIndex("uq_ledger_source").on(t.playerId,t.kind,t.sourceId)]);
export const clueUnlocks=sqliteTable("clue_unlocks",{
  playerId:text("player_id").notNull().references(()=>players.id),taskId:text("task_id").notNull().references(()=>tasks.id),
  clueIndex:integer("clue_index").notNull(),cost:integer("cost").notNull(),createdAt:integer("created_at").notNull(),
},t=>[primaryKey({columns:[t.playerId,t.taskId,t.clueIndex]})]);
export const loginChallenges=sqliteTable("login_challenges",{
  phone:text("phone").primaryKey(),playerId:text("player_id").notNull().references(()=>players.id),codeHash:text("code_hash").notNull(),
  createdAt:integer("created_at").notNull(),expiresAt:integer("expires_at").notNull(),attempts:integer("attempts").notNull().default(0),consumedId:text("consumed_id"),
});
export const shareEvents=sqliteTable("share_events",{
  id:text("id").primaryKey(),playerId:text("player_id").notNull().references(()=>players.id),taskId:text("task_id").notNull().references(()=>tasks.id),
  day:text("day").notNull(),createdAt:integer("created_at").notNull(),
},t=>[uniqueIndex("uq_share_player_task_day").on(t.playerId,t.taskId,t.day)]);

export const creatorDrafts=sqliteTable("creator_drafts",{
  eventId:text("event_id").notNull(),playerId:text("player_id").notNull().references(()=>players.id),
  revision:integer("revision").notNull().default(0),draftJson:text("draft_json"),updatedAt:integer("updated_at"),
  lastRequestId:text("last_request_id"),lastRequestHash:text("last_request_hash"),
},t=>[primaryKey({columns:[t.eventId,t.playerId]}),
  check("creator_draft_revision_nonnegative",sql`${t.revision}>=0`),
  check("creator_draft_size",sql`${t.draftJson} IS NULL OR length(${t.draftJson})<=1200000`),
  check("creator_draft_request_pair",sql`(${t.lastRequestId} IS NULL)=(${t.lastRequestHash} IS NULL)`)]);

export const merchantProfileDrafts=sqliteTable("merchant_profile_drafts",{
  eventId:text("event_id").notNull(),accountId:text("account_id").notNull().references(()=>accounts.id),
  storeId:text("store_id").notNull().references(()=>stores.id),revision:integer("revision").notNull().default(0),
  draftJson:text("draft_json"),createdAt:integer("created_at").notNull(),updatedAt:integer("updated_at").notNull(),
  lastRequestId:text("last_request_id").notNull(),lastRequestHash:text("last_request_hash").notNull(),
},t=>[primaryKey({columns:[t.eventId,t.accountId,t.storeId]}),
  check("merchant_profile_draft_revision",sql`typeof(${t.revision})='integer' AND ${t.revision}>=0`),
  check("merchant_profile_draft_size",sql`${t.draftJson} IS NULL OR (length(${t.draftJson})<=750000 AND json_valid(${t.draftJson}))`),
  check("merchant_profile_draft_request",sql`length(${t.lastRequestId})=36 AND length(${t.lastRequestHash})=64`),
  check("merchant_profile_draft_time",sql`typeof(${t.createdAt})='integer' AND typeof(${t.updatedAt})='integer' AND ${t.updatedAt}>=${t.createdAt}`)]);

export const storeActivities = sqliteTable("store_activities", {
  id: text("id").primaryKey().notNull(), eventId: text("event_id").notNull(),
  storeId: text("store_id").notNull().references(() => stores.id),
  authorId: text("author_id").notNull().references(() => players.id),
  requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(),
  title: text("title").notNull(), description: text("description").notNull(),
  startAt: integer("start_at").notNull(), endAt: integer("end_at").notNull(),
  status: text("status").notNull(), reviewNote: text("review_note").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [
  uniqueIndex("uq_activity_creation_request").on(t.eventId, t.storeId, t.requestId),
  index("idx_activity_public").on(t.eventId, t.status, t.endAt, t.storeId),
  index("idx_activity_store_updated").on(t.eventId, t.storeId, t.updatedAt),
  check("activity_title_length", sql`length(${t.title}) BETWEEN 1 AND 40`),
  check("activity_description_length", sql`length(${t.description}) BETWEEN 1 AND 500`),
  check("activity_time_order", sql`typeof(${t.startAt})='integer' AND typeof(${t.endAt})='integer' AND ${t.startAt}>0 AND ${t.endAt}>${t.startAt} AND ${t.endAt}<=253402271999999`),
  check("activity_status", sql`${t.status} IN ('pending','published','rejected','offline')`),
  check("activity_review_note_length", sql`length(${t.reviewNote})<=160`),
  check("activity_revision_positive", sql`${t.revision}>=1`),
]);
