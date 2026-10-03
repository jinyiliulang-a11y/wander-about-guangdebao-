ALTER TABLE accounts ADD COLUMN email text CHECK(email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email=lower(email) AND instr(email,'@')>1));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_accounts_role_email ON accounts(role,email) WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE email_challenges (
  id text PRIMARY KEY NOT NULL,
  role text NOT NULL CHECK(role IN ('player','merchant','admin')),
  email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email=lower(email) AND instr(email,'@')>1),
  purpose text NOT NULL CHECK(purpose IN ('login','register','bind')),
  code_hash text NOT NULL CHECK(length(code_hash)=64),
  send_status text NOT NULL CHECK(send_status IN ('pending','sent','failed')),
  created_at integer NOT NULL,
  expires_at integer NOT NULL CHECK(expires_at>created_at),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at integer,
  consume_token text,
  CHECK((consumed_at IS NULL)=(consume_token IS NULL))
);
--> statement-breakpoint
CREATE INDEX idx_email_challenge_subject ON email_challenges(role,email,created_at);
