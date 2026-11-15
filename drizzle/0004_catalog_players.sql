CREATE TABLE players (
 id TEXT PRIMARY KEY NOT NULL,
 game_id TEXT NOT NULL,
 game_key TEXT NOT NULL,
 contact TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX players_game_key_unique ON players(game_key);
INSERT INTO players (id,game_id,game_key) SELECT id,game_id,game_key FROM users;
INSERT OR IGNORE INTO players (id,game_id,game_key) VALUES ('system-admin','Bocchi_TheGlock','bocchi_theglock');
ALTER TABLE shops ADD COLUMN creator_id TEXT;
UPDATE shops SET creator_id=owner_id;
ALTER TABLE shops ADD COLUMN coordinates_known INTEGER NOT NULL DEFAULT 1;
ALTER TABLE songs ADD COLUMN instruments TEXT NOT NULL DEFAULT '["钢琴"]';
ALTER TABLE songs ADD COLUMN sale_x INTEGER;
ALTER TABLE songs ADD COLUMN sale_y INTEGER;
ALTER TABLE songs ADD COLUMN sale_z INTEGER;
CREATE TABLE import_records (
 source TEXT NOT NULL,
 source_id TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 PRIMARY KEY (source,source_id)
);
