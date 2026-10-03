CREATE TABLE recording_coupons (
  id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL REFERENCES players(id),
  event_id text NOT NULL,
  store_id text NOT NULL REFERENCES stores(id),
  coupon_code text NOT NULL UNIQUE,
  store_name_snapshot text NOT NULL,
  reward_snapshot text NOT NULL,
  conditions_snapshot text NOT NULL,
  artwork integer NOT NULL,
  issued_at integer NOT NULL,
  valid_end integer NOT NULL,
  redeemed_at integer,
  CHECK(store_id='tea' AND event_id='mall-48h'),
  CHECK(length(coupon_code)=26 AND substr(coupon_code,1,6)='GTB-D-' AND substr(coupon_code,7) NOT GLOB '*[^0-9A-F]*'),
  CHECK(valid_end>issued_at),
  CHECK(redeemed_at IS NULL OR redeemed_at>=issued_at)
);
--> statement-breakpoint
CREATE INDEX idx_recording_coupon_player ON recording_coupons(event_id,player_id,issued_at);
--> statement-breakpoint
CREATE INDEX idx_recording_coupon_store ON recording_coupons(event_id,store_id,issued_at);
--> statement-breakpoint
CREATE TABLE recording_coupon_requests (
  request_id text PRIMARY KEY NOT NULL,
  player_id text NOT NULL REFERENCES players(id),
  coupon_id text NOT NULL REFERENCES recording_coupons(id),
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER recording_coupon_initial_request AFTER INSERT ON recording_coupons BEGIN
  INSERT INTO recording_coupon_requests(request_id,player_id,coupon_id,created_at)
    VALUES(NEW.id,NEW.player_id,NEW.id,NEW.issued_at);
END;
