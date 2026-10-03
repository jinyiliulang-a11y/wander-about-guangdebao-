CREATE TABLE merchant_profile_drafts (
  event_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  revision INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_request_id TEXT NOT NULL,
  last_request_hash TEXT NOT NULL,
  PRIMARY KEY(event_id,account_id,store_id),
  CHECK(typeof(revision)='integer' AND revision>=0),
  CHECK(draft_json IS NULL OR (length(draft_json)<=750000 AND json_valid(draft_json))),
  CHECK(length(last_request_id)=36 AND length(last_request_hash)=64),
  CHECK(typeof(created_at)='integer' AND typeof(updated_at)='integer' AND updated_at>=created_at)
);
