CREATE TABLE accounts (
  id text PRIMARY KEY NOT NULL,
  request_id text UNIQUE,
  request_hash text NOT NULL,
  username text NOT NULL,
  role text NOT NULL CHECK(role IN ('player','merchant','admin')),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL CHECK(password_iterations BETWEEN 10000 AND 100000),
  player_id text NOT NULL UNIQUE REFERENCES players(id),
  store_id text REFERENCES stores(id),
  nickname text NOT NULL,
  phone text,
  merchant_json text,
  status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
  review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=160),
  review_token text,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  UNIQUE(role,username),
  CHECK(length(username) BETWEEN 3 AND 32),
  CHECK(length(password_salt)=32 AND length(password_hash)=64),
  CHECK((role='merchant' AND merchant_json IS NOT NULL) OR (role<>'merchant' AND merchant_json IS NULL)),
  CHECK((role='merchant' AND status='approved' AND store_id IS NOT NULL) OR (status<>'approved' OR role<>'merchant'))
);
CREATE INDEX idx_account_application_status ON accounts(status,created_at);
CREATE TABLE account_rate_limits (
  key text PRIMARY KEY NOT NULL,
  window_started_at integer NOT NULL,
  attempt_count integer NOT NULL CHECK(attempt_count>=1)
);
ALTER TABLE sessions ADD COLUMN account_id text REFERENCES accounts(id);
ALTER TABLE sessions ADD COLUMN legacy_authenticated integer NOT NULL DEFAULT 0 CHECK(legacy_authenticated IN (0,1));
-- Only already-issued phone login sessions retain a historical login marker (no
-- new account authorization). Contact details
-- on newly registered accounts never establish a login or merge somebody else's player.
UPDATE sessions SET legacy_authenticated=1 WHERE role='player' AND EXISTS(
  SELECT 1 FROM players p WHERE p.id=sessions.player_id AND p.phone IS NOT NULL);
-- Old demo-code/local-owner staff sessions have no account credentials and are revoked.
DELETE FROM sessions WHERE role IN ('merchant','admin');
DELETE FROM login_challenges;
