BEGIN IMMEDIATE;
CREATE TABLE ideas (
 id TEXT PRIMARY KEY, capture_text TEXT NOT NULL, title TEXT, body_json TEXT NOT NULL,
 body_schema_version INTEGER NOT NULL, created_at INTEGER NOT NULL, content_updated_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, starred_at INTEGER, archived_at INTEGER, revision INTEGER NOT NULL,
 search_text TEXT NOT NULL, capture_fingerprint TEXT NOT NULL
);
CREATE INDEX ideas_dates ON ideas(archived_at,created_at DESC,id);
CREATE INDEX ideas_edited ON ideas(archived_at,content_updated_at DESC,id);
CREATE TABLE tags(id TEXT PRIMARY KEY, axis TEXT NOT NULL CHECK(axis IN ('type','topic')),name TEXT NOT NULL,normalized_name TEXT NOT NULL,color TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(axis,normalized_name));
CREATE TABLE idea_tags(idea_id TEXT NOT NULL REFERENCES ideas(id),tag_id TEXT NOT NULL REFERENCES tags(id),created_at INTEGER NOT NULL,PRIMARY KEY(idea_id,tag_id));
CREATE INDEX idea_tags_tag ON idea_tags(tag_id,idea_id);
CREATE TABLE idea_links(id TEXT PRIMARY KEY,idea_id TEXT NOT NULL REFERENCES ideas(id),url TEXT NOT NULL,url_key TEXT NOT NULL,hostname TEXT NOT NULL,position INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(idea_id,url_key));
CREATE TABLE capture_sessions(id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('active','committed','discarded')));
CREATE TABLE capture_draft(slot INTEGER PRIMARY KEY CHECK(slot=1),capture_id TEXT UNIQUE NOT NULL REFERENCES capture_sessions(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
INSERT INTO schema_migrations VALUES(1,unixepoch()*1000);
INSERT INTO tags VALUES
 ('f1000000-0000-4000-8000-000000000001','type','Project','project','sage',unixepoch()*1000,unixepoch()*1000),
 ('f1000000-0000-4000-8000-000000000002','type','Poem','poem','rose',unixepoch()*1000,unixepoch()*1000),
 ('f1000000-0000-4000-8000-000000000003','type','Essay','essay','amber',unixepoch()*1000,unixepoch()*1000),
 ('f1000000-0000-4000-8000-000000000004','type','Video','video','sky',unixepoch()*1000,unixepoch()*1000),
 ('f1000000-0000-4000-8000-000000000005','type','Exploration','exploration','lavender',unixepoch()*1000,unixepoch()*1000);
PRAGMA user_version=1;
COMMIT;
