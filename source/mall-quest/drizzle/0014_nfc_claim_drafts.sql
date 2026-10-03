-- Saved NFC applications have no effect on official rewards until an authorized merchant issues one.
CREATE TABLE nfc_claim_drafts (
  id text PRIMARY KEY NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  player_id text NOT NULL REFERENCES players(id),
  player_account_id text NOT NULL REFERENCES accounts(id),
  player_session_hash text NOT NULL,
  event_id text NOT NULL CHECK(event_id='mall-48h'),
  store_id text NOT NULL REFERENCES stores(id),
  task_id text NOT NULL REFERENCES tasks(id),
  device_id text NOT NULL REFERENCES hardware_devices(id),
  device_token_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','deleted','issued')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  permit_until integer NOT NULL,
  location_timestamp integer NOT NULL,
  fence_revision integer NOT NULL CHECK(fence_revision>=1),
  task_title_snapshot text NOT NULL,
  store_name_snapshot text NOT NULL,
  reward_type text NOT NULL CHECK(reward_type IN ('coupon','points')),
  reward_value integer NOT NULL,
  template_id text,
  reward_snapshot text NOT NULL,
  conditions_snapshot text NOT NULL,
  coupon_type text NOT NULL,
  coupon_value real NOT NULL,
  coupon_min_amount real NOT NULL,
  valid_start integer,
  valid_end integer,
  claim_id text REFERENCES claims(id),
  coupon_code text,
  merchant_account_id text REFERENCES accounts(id),
  device_returned_at integer,
  last_request_id text NOT NULL,
  last_request_hash text NOT NULL CHECK(length(last_request_hash)=64),
  last_purpose text NOT NULL CHECK(last_purpose IN ('create','revalidate','delete','issue')),
  last_actor_account_id text NOT NULL REFERENCES accounts(id),
  CHECK((state='issued' AND claim_id IS NOT NULL AND coupon_code IS NOT NULL AND merchant_account_id IS NOT NULL AND device_returned_at IS NOT NULL)
    OR (state<>'issued' AND claim_id IS NULL AND coupon_code IS NULL AND merchant_account_id IS NULL AND device_returned_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_nfc_pending_player_store ON nfc_claim_drafts(player_id,event_id,store_id) WHERE state='pending';
CREATE INDEX idx_nfc_draft_player ON nfc_claim_drafts(player_id,event_id,state,created_at,id);
CREATE INDEX idx_nfc_draft_device ON nfc_claim_drafts(store_id,device_id,event_id,state,created_at,id);
--> statement-breakpoint
CREATE TABLE nfc_draft_operations (
  request_id text PRIMARY KEY NOT NULL,
  draft_id text NOT NULL REFERENCES nfc_claim_drafts(id),
  purpose text NOT NULL CHECK(purpose IN ('create','revalidate','delete','issue')),
  actor_account_id text NOT NULL REFERENCES accounts(id),
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  result_revision integer NOT NULL CHECK(result_revision>=1),
  created_at integer NOT NULL
);
CREATE INDEX idx_nfc_operation_draft ON nfc_draft_operations(draft_id,purpose);
--> statement-breakpoint
CREATE TRIGGER nfc_draft_created AFTER INSERT ON nfc_claim_drafts BEGIN
  INSERT INTO nfc_draft_operations(request_id,draft_id,purpose,actor_account_id,request_hash,result_revision,created_at)
    VALUES(NEW.last_request_id,NEW.id,'create',NEW.last_actor_account_id,NEW.last_request_hash,NEW.revision,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER nfc_draft_operation AFTER UPDATE ON nfc_claim_drafts WHEN NEW.revision<>OLD.revision BEGIN
  INSERT INTO nfc_draft_operations(request_id,draft_id,purpose,actor_account_id,request_hash,result_revision,created_at)
    VALUES(NEW.last_request_id,NEW.id,NEW.last_purpose,NEW.last_actor_account_id,NEW.last_request_hash,NEW.revision,NEW.updated_at);
END;
--> statement-breakpoint
-- The final authorized CAS and its claim, growth triggers and operation receipt are one SQLite statement.
-- A uniqueness or reward-trigger failure rolls back the entire statement, leaving the draft pending.
CREATE TRIGGER nfc_draft_issue AFTER UPDATE ON nfc_claim_drafts WHEN OLD.state='pending' AND NEW.state='issued' BEGIN
  INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at,reward_type,reward_value,template_id,
    reward_snapshot,conditions_snapshot,store_name_snapshot,coupon_type,coupon_value,coupon_min_amount,valid_start,valid_end,nfc_request_hash)
  VALUES(NEW.claim_id,NEW.player_id,NEW.event_id,NEW.store_id,NEW.task_id,NEW.coupon_code,NEW.updated_at,
    NEW.reward_type,NEW.reward_value,NEW.template_id,NEW.reward_snapshot,NEW.conditions_snapshot,NEW.store_name_snapshot,
    NEW.coupon_type,NEW.coupon_value,NEW.coupon_min_amount,NEW.valid_start,NEW.valid_end,NEW.last_request_hash);
END;
