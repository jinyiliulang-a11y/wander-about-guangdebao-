-- A cleared draft keeps its revision so a late save cannot resurrect it.
CREATE TABLE creator_drafts (
  event_id text NOT NULL,
  player_id text NOT NULL REFERENCES players(id),
  revision integer NOT NULL DEFAULT 0,
  draft_json text,
  updated_at integer,
  last_request_id text,
  last_request_hash text,
  PRIMARY KEY(event_id,player_id),
  CONSTRAINT creator_draft_revision_nonnegative CHECK(revision>=0),
  CONSTRAINT creator_draft_size CHECK(draft_json IS NULL OR length(draft_json)<=1200000),
  CONSTRAINT creator_draft_request_pair CHECK((last_request_id IS NULL)=(last_request_hash IS NULL))
);
