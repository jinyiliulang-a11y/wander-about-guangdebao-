-- D1 keeps foreign keys enabled within migration transactions. Defer checks
-- while rebuilding the parent under its original name, so sessions.account_id
-- continues to reference accounts(id). Do not rename the old parent table.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE accounts_email_usernames (
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
  email text CHECK(email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email=lower(email) AND instr(email,'@')>1)),
  UNIQUE(role,username),
  CHECK(length(username) BETWEEN 3 AND 254),
  CHECK(length(password_salt)=32 AND length(password_hash)=64),
  CHECK((role='merchant' AND merchant_json IS NOT NULL) OR (role<>'merchant' AND merchant_json IS NULL)),
  CHECK((role='merchant' AND status='approved' AND store_id IS NOT NULL) OR (status<>'approved' OR role<>'merchant'))
);
--> statement-breakpoint
INSERT INTO accounts_email_usernames (
  id,request_id,request_hash,username,role,password_salt,password_hash,password_iterations,
  player_id,store_id,nickname,phone,merchant_json,status,review_note,review_token,revision,created_at,updated_at,email
)
SELECT id,request_id,request_hash,username,role,password_salt,password_hash,password_iterations,
  player_id,store_id,nickname,phone,merchant_json,status,review_note,review_token,revision,created_at,updated_at,email
FROM accounts;
--> statement-breakpoint
DROP TABLE accounts;
--> statement-breakpoint
ALTER TABLE accounts_email_usernames RENAME TO accounts;
--> statement-breakpoint
CREATE INDEX idx_account_application_status ON accounts(status,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_accounts_role_email ON accounts(role,email) WHERE email IS NOT NULL;
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
