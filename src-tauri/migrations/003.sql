BEGIN IMMEDIATE;
ALTER TABLE ideas ADD COLUMN title_status TEXT NOT NULL DEFAULT 'settled'
  CHECK(title_status IN ('pending','generated','fallback','settled'));
INSERT INTO schema_migrations(version,applied_at) VALUES(3,unixepoch()*1000);
PRAGMA user_version=3;
COMMIT;
