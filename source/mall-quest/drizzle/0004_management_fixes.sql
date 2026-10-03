-- Logical deletion preserves issued coupons, points, device identity and audit history.
ALTER TABLE tasks ADD COLUMN deleted_at integer;
--> statement-breakpoint
ALTER TABLE coupon_templates ADD COLUMN deleted_at integer;
--> statement-breakpoint
ALTER TABLE feedback ADD COLUMN deleted_at integer;
--> statement-breakpoint
CREATE TABLE player_activity (
  player_id text NOT NULL REFERENCES players(id),
  day text NOT NULL,
  first_seen_at integer NOT NULL,
  PRIMARY KEY(player_id,day)
);
--> statement-breakpoint
CREATE INDEX idx_activity_day ON player_activity(day);
