ALTER TABLE players ADD COLUMN phone text;
ALTER TABLE players ADD COLUMN avatar text NOT NULL DEFAULT '🧭';
ALTER TABLE players ADD COLUMN banned integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN points_balance integer NOT NULL DEFAULT 0 CHECK(points_balance>=0);
CREATE UNIQUE INDEX uq_player_phone ON players(phone) WHERE phone IS NOT NULL;
ALTER TABLE stores ADD COLUMN logo text NOT NULL DEFAULT '🏪';
ALTER TABLE stores ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'));
ALTER TABLE tasks ADD COLUMN question text;
ALTER TABLE tasks ADD COLUMN answer text;
ALTER TABLE tasks ADD COLUMN difficulty integer NOT NULL DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5);
ALTER TABLE tasks ADD COLUMN expires_at integer;
ALTER TABLE tasks ADD COLUMN reward_type text NOT NULL DEFAULT 'coupon' CHECK(reward_type IN ('coupon','points'));
ALTER TABLE tasks ADD COLUMN reward_value integer NOT NULL DEFAULT 50 CHECK(reward_value BETWEEN 0 AND 1000);
ALTER TABLE tasks ADD COLUMN reward_coupon_id text;
ALTER TABLE tasks ADD COLUMN photo_urls text NOT NULL DEFAULT '["","","","",""]';
ALTER TABLE claims ADD COLUMN reward_type text NOT NULL DEFAULT 'coupon';
ALTER TABLE claims ADD COLUMN reward_value integer NOT NULL DEFAULT 50;
ALTER TABLE claims ADD COLUMN template_id text;
ALTER TABLE claims ADD COLUMN reward_snapshot text NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN conditions_snapshot text NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN store_name_snapshot text NOT NULL DEFAULT '';
ALTER TABLE claims ADD COLUMN coupon_type text NOT NULL DEFAULT 'gift';
ALTER TABLE claims ADD COLUMN coupon_value real NOT NULL DEFAULT 0;
ALTER TABLE claims ADD COLUMN coupon_min_amount real NOT NULL DEFAULT 0;
ALTER TABLE claims ADD COLUMN valid_start integer;
ALTER TABLE claims ADD COLUMN valid_end integer;
UPDATE claims SET reward_snapshot=(SELECT reward_title FROM stores WHERE stores.id=claims.store_id),
  conditions_snapshot=(SELECT conditions FROM stores WHERE stores.id=claims.store_id),
  store_name_snapshot=(SELECT name FROM stores WHERE stores.id=claims.store_id);
ALTER TABLE hardware_devices ADD COLUMN bound_task_id text REFERENCES tasks(id);
UPDATE hardware_devices SET bound_task_id='quest-' || store_id
  WHERE EXISTS(SELECT 1 FROM tasks WHERE tasks.id='quest-' || hardware_devices.store_id);
CREATE TABLE game_settings(
  id text PRIMARY KEY CHECK(id='main'),daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 0 AND 100),
  clue_costs text NOT NULL,contribution_ratio real NOT NULL CHECK(contribution_ratio BETWEEN 0 AND 1),
  ugc_review integer NOT NULL CHECK(ugc_review IN (0,1)),updated_at integer NOT NULL);
INSERT INTO game_settings VALUES('main',5,'[0,0,10,20,30]',0.2,1,0);
CREATE TABLE coupon_templates(
  id text PRIMARY KEY,store_id text NOT NULL REFERENCES stores(id),title text NOT NULL,
  type text NOT NULL CHECK(type IN ('discount','cash','gift')),value real NOT NULL CHECK(value>=0),
  min_amount real NOT NULL CHECK(min_amount>=0),total_count integer NOT NULL CHECK(total_count>=0),
  valid_start integer,valid_end integer,status text NOT NULL CHECK(status IN ('active','inactive')),
  created_at integer NOT NULL,updated_at integer NOT NULL,
  CHECK(valid_start IS NULL OR valid_end IS NULL OR valid_start<valid_end));
CREATE INDEX idx_coupon_template_store ON coupon_templates(store_id);
INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at)
  SELECT 'legacy-' || id,id,reward_title,'gift',0,0,stock_total,'active',0,0 FROM stores WHERE event_id='mall-48h';
UPDATE tasks SET reward_coupon_id='legacy-' || store_id WHERE reward_type='coupon' AND reward_coupon_id IS NULL
  AND EXISTS(SELECT 1 FROM coupon_templates WHERE id='legacy-' || tasks.store_id);
UPDATE claims SET template_id='legacy-' || store_id WHERE reward_type='coupon' AND template_id IS NULL
  AND EXISTS(SELECT 1 FROM coupon_templates WHERE id='legacy-' || claims.store_id);
CREATE TABLE points_ledger(
  id text PRIMARY KEY,player_id text NOT NULL REFERENCES players(id),delta integer NOT NULL,
  kind text NOT NULL,source_id text NOT NULL,reason text NOT NULL,created_at integer NOT NULL,
  UNIQUE(player_id,kind,source_id));
CREATE INDEX idx_ledger_player_time ON points_ledger(player_id,created_at);
CREATE TRIGGER ledger_balance AFTER INSERT ON points_ledger BEGIN
  UPDATE players SET points_balance=points_balance+NEW.delta WHERE id=NEW.player_id;
END;
INSERT INTO points_ledger SELECT 'initial-' || id,id,100,'initial',id,'演示初始探索积分',created_at FROM players;
INSERT INTO points_ledger SELECT 'legacy-reward-' || id,player_id,50,'claim',id,'历史领奖探索积分',issued_at FROM claims;
INSERT INTO points_ledger SELECT 'legacy-contribution-' || c.id,t.author_id,10,'contribution',c.id,'历史作品贡献积分',c.issued_at
  FROM claims c JOIN tasks t ON t.id=c.task_id WHERE t.author_id<>c.player_id;
CREATE TRIGGER player_initial_points AFTER INSERT ON players BEGIN
  INSERT INTO points_ledger VALUES('initial-' || NEW.id,NEW.id,100,'initial',NEW.id,'演示初始探索积分',NEW.created_at);
END;
CREATE TRIGGER claim_points AFTER INSERT ON claims WHEN NEW.event_id='mall-48h' BEGIN
  INSERT INTO points_ledger VALUES('reward-' || NEW.id,NEW.player_id,NEW.reward_value,'claim',NEW.id,'寻宝领奖探索积分',NEW.issued_at);
  INSERT INTO points_ledger SELECT 'contribution-' || NEW.id,t.author_id,
    CAST(NEW.reward_value*(SELECT contribution_ratio FROM game_settings WHERE id='main') AS INTEGER),
    'contribution',NEW.id,'作品被找到的贡献积分',NEW.issued_at FROM tasks t WHERE t.id=NEW.task_id AND t.author_id<>NEW.player_id;
END;
CREATE TABLE clue_unlocks(
  player_id text NOT NULL REFERENCES players(id),task_id text NOT NULL REFERENCES tasks(id),
  clue_index integer NOT NULL CHECK(clue_index BETWEEN 0 AND 4),cost integer NOT NULL CHECK(cost>=0),created_at integer NOT NULL,
  PRIMARY KEY(player_id,task_id,clue_index));
CREATE TRIGGER clue_points AFTER INSERT ON clue_unlocks WHEN NEW.cost>0 BEGIN
  INSERT INTO points_ledger VALUES('unlock-' || NEW.player_id || '-' || NEW.task_id || '-' || NEW.clue_index,
    NEW.player_id,-NEW.cost,'unlock',NEW.task_id || ':' || NEW.clue_index,'解锁寻宝线索',NEW.created_at);
END;
CREATE TABLE login_challenges(
  phone text PRIMARY KEY,player_id text NOT NULL REFERENCES players(id),code_hash text NOT NULL,
  created_at integer NOT NULL,expires_at integer NOT NULL,attempts integer NOT NULL DEFAULT 0,
  consumed_id text);
CREATE TABLE share_events(id text PRIMARY KEY,player_id text NOT NULL REFERENCES players(id),
  task_id text NOT NULL REFERENCES tasks(id),day text NOT NULL,created_at integer NOT NULL,
  UNIQUE(player_id,task_id,day));
CREATE TRIGGER claim_achievements AFTER INSERT ON claims WHEN NEW.event_id='mall-48h' BEGIN
  INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || NEW.player_id || '-a1',NEW.player_id,50,'achievement','a1','初出茅庐成就',NEW.issued_at
    WHERE (SELECT COUNT(*) FROM claims WHERE player_id=NEW.player_id AND event_id='mall-48h')>=1;
  INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || NEW.player_id || '-a2',NEW.player_id,100,'achievement','a2','寻宝新手成就',NEW.issued_at
    WHERE (SELECT COUNT(*) FROM claims WHERE player_id=NEW.player_id AND event_id='mall-48h')>=5;
  INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || NEW.player_id || '-a3',NEW.player_id,200,'achievement','a3','寻宝达人成就',NEW.issued_at
    WHERE (SELECT COUNT(*) FROM claims WHERE player_id=NEW.player_id AND event_id='mall-48h')>=10;
  INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || NEW.player_id || '-a5',NEW.player_id,500,'achievement','a5','金币大师成就',NEW.issued_at
    WHERE (SELECT COUNT(*) FROM claims WHERE player_id=NEW.player_id AND event_id='mall-48h')>=50;
  INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || NEW.player_id || '-a4',NEW.player_id,150,'achievement','a4','连续七日成就',NEW.issued_at
    WHERE (SELECT COUNT(DISTINCT date(issued_at/1000,'unixepoch','+8 hours')) FROM claims
      WHERE player_id=NEW.player_id AND event_id='mall-48h'
        AND date(issued_at/1000,'unixepoch','+8 hours') BETWEEN date(NEW.issued_at/1000,'unixepoch','+8 hours','-6 days') AND date(NEW.issued_at/1000,'unixepoch','+8 hours'))>=7;
END;
CREATE TRIGGER share_achievement AFTER INSERT ON share_events BEGIN
  INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || NEW.player_id || '-a6',NEW.player_id,120,'achievement','a6','生成分享成就',NEW.created_at
    WHERE (SELECT COUNT(*) FROM share_events WHERE player_id=NEW.player_id)>=10;
END;
INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || player_id || '-a1',player_id,50,'achievement','a1','历史初出茅庐成就',MAX(issued_at)
  FROM claims WHERE event_id='mall-48h' GROUP BY player_id HAVING COUNT(*)>=1;
INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || player_id || '-a2',player_id,100,'achievement','a2','历史寻宝新手成就',MAX(issued_at)
  FROM claims WHERE event_id='mall-48h' GROUP BY player_id HAVING COUNT(*)>=5;
INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || player_id || '-a3',player_id,200,'achievement','a3','历史寻宝达人成就',MAX(issued_at)
  FROM claims WHERE event_id='mall-48h' GROUP BY player_id HAVING COUNT(*)>=10;
INSERT OR IGNORE INTO points_ledger SELECT 'achievement-' || player_id || '-a5',player_id,500,'achievement','a5','历史金币大师成就',MAX(issued_at)
  FROM claims WHERE event_id='mall-48h' GROUP BY player_id HAVING COUNT(*)>=50;
