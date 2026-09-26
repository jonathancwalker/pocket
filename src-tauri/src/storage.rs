use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::mpsc,
    time::{SystemTime, UNIX_EPOCH},
};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, AppError>;
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}
impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for AppError {}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("storage", "Could not read or save your library. Your current text is still available. Check disk space and try again.")
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::new(
            "validation",
            "This content could not be read. The original data has been preserved.",
        )
    }
}
impl From<std::io::Error> for AppError {
    fn from(_: std::io::Error) -> Self {
        Self::new(
            "storage",
            "The file could not be written. Check its location and available disk space.",
        )
    }
}
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn normalized(text: &str) -> String {
    text.nfkc().flat_map(char::to_lowercase).collect()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn valid_id(s: &str) -> Result<()> {
    Uuid::parse_str(s)
        .map(|_| ())
        .map_err(|_| AppError::new("validation", "Invalid record identifier."))
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::new("validation", "A required value is missing."))
}

fn capture_tag_directive(text: &str) -> (Option<String>, String) {
    let Some(after_open) = text.strip_prefix('[') else {
        return (None, text.into());
    };
    let Some(close) = after_open.find(']') else {
        return (None, text.into());
    };
    let tag = after_open[..close].trim();
    if tag.is_empty() || tag.contains(['\n', '\r']) || tag.chars().count() > 60 {
        return (None, text.into());
    }
    (
        Some(tag.into()),
        after_open[close + 1..].trim_start().into(),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: String,
    pub url: String,
    pub key: String,
    pub hostname: String,
}
pub fn reference(id: &str, input: &str) -> Result<Reference> {
    valid_id(id)?;
    let raw = input.trim();
    let parsed = url::Url::parse(raw)
        .map_err(|_| AppError::new("validation", "Paste a web link, starting with https://"))?;
    if raw.chars().any(char::is_whitespace)
        || !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::new(
            "validation",
            "Paste one complete web link, starting with https://",
        ));
    }
    Ok(Reference {
        id: id.into(),
        url: raw.into(),
        key: parsed.to_string(),
        hostname: parsed.host_str().unwrap_or_default().into(),
    })
}
fn validate_links(links: &[Reference]) -> Result<Vec<Reference>> {
    if links.len() > 200 {
        return Err(AppError::new(
            "validation",
            "An idea can have up to 200 references.",
        ));
    }
    let mut keys = std::collections::HashSet::new();
    let mut ids = std::collections::HashSet::new();
    links
        .iter()
        .map(|link| {
            let valid = reference(&link.id, &link.url)?;
            if !keys.insert(valid.key.clone()) || !ids.insert(valid.id.clone()) {
                return Err(AppError::new(
                    "validation",
                    "This reference is already attached.",
                ));
            }
            Ok(valid)
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub text: String,
    pub links: Vec<Reference>,
    pub phrase: usize,
    pub sequence: i64,
    pub updated_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub axis: String,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    pub id: String,
    pub capture_text: String,
    pub title: Option<String>,
    pub body: Value,
    pub body_schema_version: i64,
    pub created_at: i64,
    pub content_updated_at: i64,
    pub updated_at: i64,
    pub starred_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub revision: i64,
    pub links: Vec<Reference>,
    pub tags: Vec<Tag>,
}
pub fn empty_body() -> Value {
    json!({"type":"doc","content":[{"type":"paragraph"}]})
}

pub fn body_from_capture(text: &str) -> Value {
    if text.is_empty() {
        return empty_body();
    }
    json!({
        "type": "doc",
        "content": text
            .split('\n')
            .map(|line| {
                if line.is_empty() {
                    json!({"type":"paragraph"})
                } else {
                    json!({"type":"paragraph","content":[{"type":"text","text":line}]})
                }
            })
            .collect::<Vec<_>>()
    })
}

pub fn body_text(body: &Value, version: i64) -> Result<String> {
    if version != 1 || body.get("type").and_then(Value::as_str) != Some("doc") {
        return Err(AppError::new(
            "body_schema",
            "This writing uses an unsupported format. Its original content has been preserved.",
        ));
    }
    fn walk(node: &Value, depth: usize, total: &mut usize) -> Result<String> {
        *total += 1;
        if depth > 64 || *total > 100_000 {
            return Err(AppError::new(
                "validation",
                "This document is too complex to save.",
            ));
        }
        let kind = string(node, "type")?;
        if !matches!(
            kind,
            "doc"
                | "paragraph"
                | "heading"
                | "text"
                | "hardBreak"
                | "bulletList"
                | "orderedList"
                | "listItem"
                | "blockquote"
        ) {
            return Err(AppError::new(
                "body_schema",
                "This document contains unsupported formatting.",
            ));
        }
        if kind == "heading" && !matches!(node["attrs"]["level"].as_i64(), Some(1..=3)) {
            return Err(AppError::new("body_schema", "Unsupported heading level."));
        }
        if let Some(marks) = node.get("marks") {
            for mark in marks
                .as_array()
                .ok_or_else(|| AppError::new("body_schema", "Invalid formatting."))?
            {
                match string(mark, "type")? {
                    "bold" | "italic" => {}
                    "link" => {
                        reference(&id(), string(&mark["attrs"], "href")?)?;
                    }
                    _ => return Err(AppError::new("body_schema", "Unsupported text formatting.")),
                }
            }
        }
        if kind == "text" {
            return Ok(string(node, "text")?.to_owned());
        }
        if kind == "hardBreak" {
            return Ok("\n".into());
        }
        let mut out = Vec::new();
        if let Some(content) = node.get("content") {
            for child in content
                .as_array()
                .ok_or_else(|| AppError::new("body_schema", "Invalid document structure."))?
            {
                out.push(walk(child, depth + 1, total)?);
            }
        }
        Ok(out.join(
            if matches!(
                kind,
                "doc" | "bulletList" | "orderedList" | "listItem" | "blockquote"
            ) {
                "\n"
            } else {
                ""
            },
        ))
    }
    walk(body, 0, &mut 0)
}

pub struct Store {
    conn: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(3))?;
        Self::initialize(conn, Some(path))
    }
    fn initialize(mut conn: Connection, path: Option<&Path>) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        let mut version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        let new_library = version == 0;
        if version > 2 {
            return Err(AppError::new("newer_database", "This library was created by a newer version. Update Pocket to open it; your data has not been changed."));
        }
        let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(AppError::new("damaged_database", "The library needs recovery. Your database has been preserved; see the recovery instructions."));
        }
        if version == 0 {
            if let Some(path) = path.filter(|_| !new_library) {
                let has_tables: bool = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table')",
                    [],
                    |r| r.get(0),
                )?;
                if has_tables {
                    conn.backup(
                        "main",
                        path.with_extension(format!("before-v1-{}.sqlite3", now())),
                        None,
                    )?;
                }
            }
            conn.execute_batch(include_str!("../migrations/001.sql"))?;
            version = 1;
        }
        if version == 1 {
            if let Some(path) = path.filter(|_| !new_library) {
                conn.backup(
                    "main",
                    path.with_extension(format!("before-v2-{}.sqlite3", now())),
                    None,
                )?;
            }
            Self::migrate_capture_text_into_body(&mut conn)?;
        }
        Ok(Self { conn })
    }
    fn migrate_capture_text_into_body(conn: &mut Connection) -> Result<()> {
        let ideas = {
            let mut statement = conn
                .prepare("SELECT id,title,capture_text,body_json,body_schema_version FROM ideas")?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let tx = conn.transaction()?;
        for (id, title, capture, serialized_body, version) in ideas {
            let body: Value = serde_json::from_str(&serialized_body)?;
            if capture.trim().is_empty() || !body_text(&body, version)?.trim().is_empty() {
                continue;
            }
            let body = body_from_capture(&capture);
            let search = normalized(&format!(
                "{}\n{}\n{}",
                title.as_deref().unwrap_or(""),
                capture,
                body_text(&body, 1)?
            ));
            tx.execute(
                "UPDATE ideas SET body_json=?1,body_schema_version=1,search_text=?2 WHERE id=?3",
                params![body.to_string(), search, id],
            )?;
        }
        tx.execute(
            "INSERT INTO schema_migrations(version,applied_at) VALUES(2,?1)",
            [now()],
        )?;
        tx.execute_batch("PRAGMA user_version=2;")?;
        tx.commit()?;
        Ok(())
    }
    #[cfg(test)]
    fn memory() -> Self {
        Self::initialize(Connection::open_in_memory().unwrap(), None).unwrap()
    }

    pub fn execute(&mut self, operation: &str, input: Value) -> Result<Value> {
        match operation {
            "get_draft" => Ok(serde_json::to_value(self.draft()?)?),
            "save_draft" => {
                let d: Draft = serde_json::from_value(input)?;
                Ok(serde_json::to_value(self.save_draft(d)?)?)
            }
            "discard_draft" => {
                self.discard(string(&input, "id")?)?;
                Ok(Value::Null)
            }
            "commit_capture" => {
                let d: Draft = serde_json::from_value(input)?;
                Ok(serde_json::to_value(self.commit(d)?)?)
            }
            "list_ideas" => self.list(&input),
            "random_idea" => self.random_idea(&input),
            "get_idea" => Ok(serde_json::to_value(self.idea(string(&input, "id")?)?)?),
            "update_content" => self.update(&input),
            "set_starred" | "set_archived" => self.set_state(operation, &input),
            "list_tags" => Ok(serde_json::to_value(self.tags()?)?),
            "create_tag" | "rename_tag" => self.save_tag(operation, &input),
            "tag_usage" => self.tag_usage(&input),
            "delete_tag" => self.delete_tag(&input),
            "set_tag" => self.set_tag(&input),
            "add_link" | "remove_link" => self.edit_link(operation, &input),
            "get_settings" => self.settings(),
            "set_settings" => {
                self.conn.execute("INSERT INTO app_settings(key,value) VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [input.to_string()])?;
                Ok(input)
            }
            "export_data" => self.export(),
            _ => Err(AppError::new("validation", "Unknown library operation.")),
        }
    }
    pub fn draft(&mut self) -> Result<Draft> {
        let stored: Option<String> = self
            .conn
            .query_row("SELECT payload FROM capture_draft WHERE slot=1", [], |r| {
                r.get(0)
            })
            .optional()?;
        if let Some(stored) = stored {
            return Ok(serde_json::from_str(&stored)?);
        }
        let phrase: Option<usize> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key='last_phrase'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .and_then(|s| s.parse().ok());
        let next = phrase.map(|p| (p + 1) % 6).unwrap_or(0);
        let draft = Draft {
            id: id(),
            text: String::new(),
            links: vec![],
            phrase: next,
            sequence: 0,
            updated_at: now(),
        };
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO capture_sessions(id,state) VALUES(?1,'active')",
            [&draft.id],
        )?;
        tx.execute(
            "INSERT INTO capture_draft(slot,capture_id,sequence,payload) VALUES(1,?1,0,?2)",
            params![draft.id, serde_json::to_string(&draft)?],
        )?;
        tx.execute("INSERT INTO app_settings(key,value) VALUES('last_phrase',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [next.to_string()])?;
        tx.commit()?;
        Ok(draft)
    }
    fn validate_draft(&self, d: &mut Draft) -> Result<()> {
        valid_id(&d.id)?;
        if d.text.len() > 2_000_000 || d.sequence < 0 || d.phrase > 5 {
            return Err(AppError::new(
                "validation",
                "This draft is too large or invalid.",
            ));
        }
        d.links = validate_links(&d.links)?;
        Ok(())
    }
    pub fn save_draft(&mut self, mut d: Draft) -> Result<Draft> {
        self.validate_draft(&mut d)?;
        let existing: Option<(i64, String)> = self
            .conn
            .query_row(
                "SELECT sequence,payload FROM capture_draft WHERE capture_id=?1",
                [&d.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (sequence, original) = existing.ok_or_else(|| {
            AppError::new(
                "retired_draft",
                "This capture has already been saved or discarded.",
            )
        })?;
        if d.sequence < sequence {
            return Err(AppError::new(
                "stale_draft",
                "A newer version of this draft is already saved.",
            ));
        }
        if d.sequence == sequence {
            let old: Draft = serde_json::from_str(&original)?;
            if old.text != d.text || old.links != d.links || old.phrase != d.phrase {
                return Err(AppError::new(
                    "stale_draft",
                    "A newer version of this draft is already saved.",
                ));
            }
            return Ok(old);
        }
        d.updated_at = now();
        self.conn.execute(
            "UPDATE capture_draft SET sequence=?1,payload=?2 WHERE capture_id=?3",
            params![d.sequence, serde_json::to_string(&d)?, d.id],
        )?;
        Ok(d)
    }
    pub fn discard(&mut self, id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE capture_sessions SET state='discarded' WHERE id=?1 AND state='active'",
            [id],
        )?;
        tx.execute("DELETE FROM capture_draft WHERE capture_id=?1", [id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn commit(&mut self, mut d: Draft) -> Result<Idea> {
        self.validate_draft(&mut d)?;
        let (tag_name, capture_text) = capture_tag_directive(&d.text);
        if capture_text.trim().is_empty() && d.links.is_empty() {
            return Err(AppError::new(
                "empty",
                "A thought or a link is all you need.",
            ));
        }
        let fingerprint = json!([d.text, d.links]).to_string();
        let previous: Option<String> = self
            .conn
            .query_row(
                "SELECT capture_fingerprint FROM ideas WHERE id=?1",
                [&d.id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(previous) = previous {
            if previous == fingerprint {
                return self.idea(&d.id);
            }
            return Err(AppError::new(
                "conflict",
                "An idea with this capture ID already exists. Your text has been retained.",
            ));
        }
        self.save_draft(d.clone())?;
        let t = now();
        let tx = self.conn.transaction()?;
        let body = body_from_capture(&capture_text);
        tx.execute("INSERT INTO ideas(id,capture_text,body_json,body_schema_version,created_at,content_updated_at,updated_at,revision,search_text,capture_fingerprint) VALUES(?1,?2,?3,1,?4,?4,?4,1,?5,?6)", params![d.id,capture_text,body.to_string(),t,normalized(&format!("{}\n{}",body_text(&body,1)?,d.links.iter().map(|l| l.url.as_str()).collect::<Vec<_>>().join("\n"))),fingerprint])?;
        for (position, l) in d.links.iter().enumerate() {
            tx.execute("INSERT INTO idea_links(id,idea_id,url,url_key,hostname,position,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)", params![l.id,d.id,l.url,l.key,l.hostname,position,t])?;
        }
        if let Some(tag) = tag_name {
            Self::attach_capture_tag(&tx, &d.id, &tag)?;
        }
        tx.execute("DELETE FROM capture_draft WHERE capture_id=?1", [&d.id])?;
        tx.execute(
            "UPDATE capture_sessions SET state='committed' WHERE id=?1",
            [&d.id],
        )?;
        tx.commit()?;
        self.idea(&d.id)
    }
    fn attach_capture_tag(tx: &rusqlite::Transaction<'_>, idea_id: &str, name: &str) -> Result<()> {
        let normalized_name = normalized(name);
        let matches = {
            let mut statement = tx.prepare(
                "SELECT id FROM tags WHERE normalized_name=?1 ORDER BY CASE axis WHEN 'type' THEN 0 ELSE 1 END,id",
            )?;
            let rows = statement
                .query_map([&normalized_name], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let tag_ids = if matches.is_empty() {
            let type_count: i64 =
                tx.query_row("SELECT count(*) FROM tags WHERE axis='type'", [], |row| {
                    row.get(0)
                })?;
            let tag_id = id();
            let color =
                ["sage", "rose", "amber", "sky", "lavender", "clay"][type_count as usize % 6];
            tx.execute(
                "INSERT INTO tags(id,axis,name,normalized_name,color,created_at,updated_at) VALUES(?1,'type',?2,?3,?4,?5,?5)",
                params![tag_id, name, normalized_name, color, now()],
            )?;
            vec![tag_id]
        } else {
            matches
        };
        for tag_id in tag_ids {
            tx.execute(
                "INSERT OR IGNORE INTO idea_tags(idea_id,tag_id,created_at) VALUES(?1,?2,?3)",
                params![idea_id, tag_id, now()],
            )?;
        }
        Ok(())
    }
    pub fn idea(&self, id: &str) -> Result<Idea> {
        let mut idea = self.conn.query_row("SELECT id,capture_text,title,body_json,body_schema_version,created_at,content_updated_at,updated_at,starred_at,archived_at,revision FROM ideas WHERE id=?1", [id], |r| Ok((Idea { id:r.get(0)?,capture_text:r.get(1)?,title:r.get(2)?,body:Value::Null,body_schema_version:r.get(4)?,created_at:r.get(5)?,content_updated_at:r.get(6)?,updated_at:r.get(7)?,starred_at:r.get(8)?,archived_at:r.get(9)?,revision:r.get(10)?,links:vec![],tags:vec![] },r.get::<_,String>(3)?))).optional()?.ok_or_else(|| AppError::new("missing", "This idea could not be found."))?;
        idea.0.body = serde_json::from_str(&idea.1)?;
        body_text(&idea.0.body, idea.0.body_schema_version)?;
        let mut statement = self.conn.prepare(
            "SELECT id,url,url_key,hostname FROM idea_links WHERE idea_id=?1 ORDER BY position,id",
        )?;
        idea.0.links = statement
            .query_map([id], |r| {
                Ok(Reference {
                    id: r.get(0)?,
                    url: r.get(1)?,
                    key: r.get(2)?,
                    hostname: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        let mut statement = self.conn.prepare("SELECT t.id,t.axis,t.name,t.color FROM tags t JOIN idea_tags it ON t.id=it.tag_id WHERE it.idea_id=?1 ORDER BY t.axis,t.normalized_name")?;
        idea.0.tags = statement
            .query_map([id], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    axis: r.get(1)?,
                    name: r.get(2)?,
                    color: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(idea.0)
    }
    fn list(&self, input: &Value) -> Result<Value> {
        let mut clauses = vec![match input["view"].as_str().unwrap_or("active") {
            "archive" => "i.archived_at IS NOT NULL".to_owned(),
            "starred" => "i.archived_at IS NULL AND i.starred_at IS NOT NULL".to_owned(),
            _ => "i.archived_at IS NULL".to_owned(),
        }];
        let mut values: Vec<rusqlite::types::Value> = vec![];
        if let Some(q) = input["query"].as_str().filter(|q| !q.trim().is_empty()) {
            clauses.push("instr(i.search_text,?)>0".into());
            values.push(normalized(q.trim()).into());
        }
        for (field, axis) in [("types", "type"), ("topics", "topic")] {
            let no_type = axis == "type" && input["noType"].as_bool() == Some(true);
            let missing_type = "NOT EXISTS(SELECT 1 FROM idea_tags it JOIN tags t ON t.id=it.tag_id WHERE it.idea_id=i.id AND t.axis='type')";
            if let Some(tags) = input[field].as_array().filter(|a| !a.is_empty()) {
                let placeholders = tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                let selected = format!("EXISTS(SELECT 1 FROM idea_tags it JOIN tags t ON t.id=it.tag_id WHERE it.idea_id=i.id AND t.axis='{axis}' AND it.tag_id IN ({placeholders}))");
                clauses.push(if no_type {
                    format!("({selected} OR {missing_type})")
                } else {
                    selected
                });
                for tag in tags {
                    values.push(
                        tag.as_str()
                            .ok_or_else(|| AppError::new("validation", "Invalid tag filter."))?
                            .to_owned()
                            .into(),
                    );
                }
            } else if no_type {
                clauses.push(missing_type.into());
            }
        }
        if input["hasLinks"].as_bool() == Some(true) {
            clauses.push("EXISTS(SELECT 1 FROM idea_links l WHERE l.idea_id=i.id)".into());
        }
        if input["untagged"].as_bool() == Some(true) {
            clauses.push("NOT EXISTS(SELECT 1 FROM idea_tags it WHERE it.idea_id=i.id)".into());
        }
        if let Some(from) = input["from"].as_i64() {
            clauses.push("i.created_at >= ?".into());
            values.push(from.into());
        }
        if let Some(to) = input["to"].as_i64() {
            clauses.push("i.created_at < ?".into());
            values.push(to.into());
        }
        let where_sql = clauses.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT count(*) FROM ideas i WHERE {where_sql}"),
            params_from_iter(values.iter()),
            |r| r.get(0),
        )?;
        let order = match input["sort"].as_str() {
            Some("oldest") => "i.created_at ASC,i.id ASC",
            Some("edited") => "i.content_updated_at DESC,i.id DESC",
            _ => "i.created_at DESC,i.id DESC",
        };
        values.push(input["limit"].as_i64().unwrap_or(60).clamp(1, 200).into());
        values.push(input["offset"].as_i64().unwrap_or(0).max(0).into());
        let mut statement = self.conn.prepare(&format!(
            "SELECT i.id FROM ideas i WHERE {where_sql} ORDER BY {order} LIMIT ? OFFSET ?"
        ))?;
        let ids = statement
            .query_map(params_from_iter(values.iter()), |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let ideas = ids
            .iter()
            .map(|id| self.idea(id))
            .collect::<Result<Vec<_>>>()?;
        let (active,starred,archived): (i64,i64,i64) = self.conn.query_row("SELECT coalesce(sum(archived_at IS NULL),0),coalesce(sum(archived_at IS NULL AND starred_at IS NOT NULL),0),coalesce(sum(archived_at IS NOT NULL),0) FROM ideas", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        Ok(
            json!({"ideas":ideas,"total":total,"active":active,"starred":starred,"archived":archived}),
        )
    }
    fn random_idea(&self, input: &Value) -> Result<Value> {
        let exclude = input["exclude"].as_str().unwrap_or("");
        let selected: Option<String> = self.conn.query_row(
            "SELECT id FROM ideas WHERE archived_at IS NULL AND id != ?1 ORDER BY random() LIMIT 1",
            [exclude], |row| row.get(0),
        ).optional()?;
        selected
            .map(|id| {
                self.idea(&id)
                    .and_then(|idea| Ok(serde_json::to_value(idea)?))
            })
            .transpose()
            .map(|idea| idea.unwrap_or(Value::Null))
    }
    fn update(&mut self, input: &Value) -> Result<Value> {
        let id = string(input, "id")?;
        let current = self.idea(id)?;
        if input["revision"].as_i64() != Some(current.revision) {
            return Err(AppError::new("conflict", "This idea changed elsewhere. Your current writing has been retained; copy it before reloading."));
        }
        let title = match input.get("title") {
            Some(Value::Null) => None,
            Some(v) => Some(
                v.as_str()
                    .ok_or_else(|| AppError::new("validation", "Invalid title."))?
                    .trim()
                    .to_owned(),
            )
            .filter(|s| !s.is_empty()),
            None => current.title,
        };
        let capture = input["captureText"]
            .as_str()
            .unwrap_or(&current.capture_text);
        let body = input.get("body").unwrap_or(&current.body);
        let version = input["bodySchemaVersion"]
            .as_i64()
            .unwrap_or(current.body_schema_version);
        let text = body_text(body, version)?;
        if capture.len() > 2_000_000
            || body.to_string().len() > 4_000_000
            || title.as_ref().is_some_and(|s| s.len() > 1000)
        {
            return Err(AppError::new(
                "validation",
                "This idea is too large to save.",
            ));
        }
        let search = normalized(&format!(
            "{}\n{}\n{}\n{}",
            title.as_deref().unwrap_or(""),
            capture,
            text,
            current
                .links
                .iter()
                .map(|l| l.url.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        ));
        self.conn.execute("UPDATE ideas SET title=?1,capture_text=?2,body_json=?3,body_schema_version=?4,search_text=?5,content_updated_at=?6,updated_at=?6,revision=revision+1 WHERE id=?7 AND revision=?8", params![title,capture,body.to_string(),version,search,now(),id,current.revision])?;
        Ok(serde_json::to_value(self.idea(id)?)?)
    }
    fn set_state(&mut self, operation: &str, input: &Value) -> Result<Value> {
        let id = string(input, "id")?;
        self.idea(id)?;
        let enabled = input["enabled"]
            .as_bool()
            .ok_or_else(|| AppError::new("validation", "Invalid state."))?;
        let column = if operation == "set_starred" {
            "starred_at"
        } else {
            "archived_at"
        };
        self.conn.execute(&format!("UPDATE ideas SET {column}=?1,updated_at=?2,revision=revision+1 WHERE id=?3 AND ({column} IS NOT NULL) != ?4"), params![if enabled {Some(now())} else {None},now(),id,enabled])?;
        Ok(serde_json::to_value(self.idea(id)?)?)
    }
    fn tags(&self) -> Result<Vec<Tag>> {
        let mut statement = self
            .conn
            .prepare("SELECT id,axis,name,color FROM tags ORDER BY axis,normalized_name")?;
        let tags = statement
            .query_map([], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    axis: r.get(1)?,
                    name: r.get(2)?,
                    color: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tags)
    }
    fn save_tag(&mut self, operation: &str, input: &Value) -> Result<Value> {
        let name = string(input, "name")?.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return Err(AppError::new(
                "validation",
                "Use a tag name between 1 and 60 characters.",
            ));
        }
        let existing = if operation == "rename_tag" {
            self.tags()?
                .into_iter()
                .find(|t| Some(t.id.as_str()) == input["id"].as_str())
                .ok_or_else(|| AppError::new("missing", "This tag could not be found."))?
        } else {
            let axis = string(input, "axis")?;
            if !matches!(axis, "type" | "topic") {
                return Err(AppError::new("validation", "Invalid tag category."));
            }
            let count: i64 =
                self.conn
                    .query_row("SELECT count(*) FROM tags WHERE axis='type'", [], |r| {
                        r.get(0)
                    })?;
            Tag {
                id: id(),
                axis: axis.into(),
                name: name.into(),
                color: if axis == "type" {
                    Some(
                        ["sage", "rose", "amber", "sky", "lavender", "clay"][count as usize % 6]
                            .into(),
                    )
                } else {
                    None
                },
            }
        };
        let collision: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM tags WHERE axis=?1 AND normalized_name=?2 AND id!=?3)",
            params![existing.axis, normalized(name), existing.id],
            |r| r.get(0),
        )?;
        if collision {
            return Err(AppError::new(
                "duplicate_tag",
                "That tag already exists. Choose the existing tag or a different name.",
            ));
        }
        self.conn.execute("INSERT INTO tags(id,axis,name,normalized_name,color,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,updated_at=excluded.updated_at",params![existing.id,existing.axis,name,normalized(name),existing.color,now()])?;
        Ok(json!({"id":existing.id,"axis":existing.axis,"name":name,"color":existing.color}))
    }
    fn tag_usage(&self, input: &Value) -> Result<Value> {
        let tag_id = string(input, "id")?;
        let tag = self
            .tags()?
            .into_iter()
            .find(|tag| tag.id == tag_id)
            .ok_or_else(|| AppError::new("missing", "This tag could not be found."))?;
        let ideas: i64 = self.conn.query_row(
            "SELECT count(*) FROM idea_tags WHERE tag_id=?1",
            [tag_id],
            |row| row.get(0),
        )?;
        Ok(json!({"id":tag.id,"axis":tag.axis,"name":tag.name,"ideas":ideas}))
    }
    fn delete_tag(&mut self, input: &Value) -> Result<Value> {
        let tag_id = string(input, "id")?;
        let tag = self
            .tags()?
            .into_iter()
            .find(|tag| tag.id == tag_id)
            .ok_or_else(|| AppError::new("missing", "This tag could not be found."))?;
        if tag.axis != "type" {
            return Err(AppError::new(
                "validation",
                "Only Type tags can be deleted.",
            ));
        }
        let tx = self.conn.transaction()?;
        let ideas: i64 = tx.query_row(
            "SELECT count(*) FROM idea_tags WHERE tag_id=?1",
            [tag_id],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE ideas SET updated_at=?1,revision=revision+1 WHERE id IN (SELECT idea_id FROM idea_tags WHERE tag_id=?2)",
            params![now(), tag_id],
        )?;
        tx.execute("DELETE FROM idea_tags WHERE tag_id=?1", [tag_id])?;
        tx.execute("DELETE FROM tags WHERE id=?1", [tag_id])?;
        tx.commit()?;
        Ok(json!({"id":tag.id,"name":tag.name,"ideas":ideas}))
    }
    fn set_tag(&mut self, input: &Value) -> Result<Value> {
        let idea_id = string(input, "id")?;
        self.idea(idea_id)?;
        let tag_id = string(input, "tagId")?;
        let tx = self.conn.transaction()?;
        let changed = if input["enabled"].as_bool() == Some(true) {
            tx.execute(
                "INSERT OR IGNORE INTO idea_tags(idea_id,tag_id,created_at) VALUES(?1,?2,?3)",
                params![idea_id, tag_id, now()],
            )?
        } else {
            tx.execute(
                "DELETE FROM idea_tags WHERE idea_id=?1 AND tag_id=?2",
                params![idea_id, tag_id],
            )?
        };
        if changed > 0 {
            tx.execute(
                "UPDATE ideas SET updated_at=?1,revision=revision+1 WHERE id=?2",
                params![now(), idea_id],
            )?;
        }
        tx.commit()?;
        Ok(serde_json::to_value(self.idea(idea_id)?)?)
    }
    fn edit_link(&mut self, operation: &str, input: &Value) -> Result<Value> {
        let idea_id = string(input, "id")?;
        let mut idea = self.idea(idea_id)?;
        let tx = self.conn.transaction()?;
        if operation == "add_link" {
            let new = reference(
                string(&input["link"], "id")?,
                string(&input["link"], "url")?,
            )?;
            if idea.links.iter().any(|l| l.key == new.key) {
                return Ok(serde_json::to_value(idea)?);
            }
            if idea.links.len() >= 200 {
                return Err(AppError::new(
                    "validation",
                    "An idea can have up to 200 references.",
                ));
            }
            let pos: i64 = tx.query_row(
                "SELECT coalesce(max(position),-1)+1 FROM idea_links WHERE idea_id=?1",
                [idea_id],
                |r| r.get(0),
            )?;
            tx.execute("INSERT INTO idea_links(id,idea_id,url,url_key,hostname,position,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",params![new.id,idea_id,new.url,new.key,new.hostname,pos,now()])?;
            idea.links.push(new);
        } else {
            let link_id = string(input, "linkId")?;
            tx.execute(
                "DELETE FROM idea_links WHERE id=?1 AND idea_id=?2",
                params![link_id, idea_id],
            )?;
            idea.links.retain(|l| l.id != link_id);
        }
        let search = normalized(&format!(
            "{}\n{}\n{}\n{}",
            idea.title.as_deref().unwrap_or(""),
            idea.capture_text,
            body_text(&idea.body, idea.body_schema_version)?,
            idea.links
                .iter()
                .map(|l| l.url.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        ));
        tx.execute("UPDATE ideas SET search_text=?1,updated_at=?2,content_updated_at=?2,revision=revision+1 WHERE id=?3",params![search,now(),idea_id])?;
        tx.commit()?;
        Ok(serde_json::to_value(self.idea(idea_id)?)?)
    }
    pub fn settings(&self) -> Result<Value> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key='preferences'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let mut settings = json!({"shortcut":"CommandOrControl+Shift+Space","doubleCommand":false,"launchAtLogin":false,"onboardingDone":false,"pocketIdeas":true});
        if let Some(value) = value {
            let stored: Value = serde_json::from_str(&value)?;
            if let Some(stored) = stored.as_object() {
                settings.as_object_mut().unwrap().extend(stored.clone());
            }
        }
        Ok(settings)
    }
    fn export(&self) -> Result<Value> {
        let mut statement = self
            .conn
            .prepare("SELECT id FROM ideas ORDER BY created_at,id")?;
        let ids = statement
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let ideas = ids
            .iter()
            .map(|id| self.idea(id))
            .collect::<Result<Vec<_>>>()?;
        let draft: Option<String> = self
            .conn
            .query_row("SELECT payload FROM capture_draft WHERE slot=1", [], |r| {
                r.get(0)
            })
            .optional()?;
        let draft: Option<Value> = draft.map(|s| serde_json::from_str(&s)).transpose()?;
        Ok(
            json!({"format":"idea-capture","version":1,"exportedAt":now(),"timestampUnit":"milliseconds-since-unix-epoch-UTC","bodyFormat":"tiptap-json","ideas":ideas,"tags":self.tags()?,"draft":draft}),
        )
    }
}

struct Request {
    operation: String,
    input: Value,
    reply: tokio::sync::oneshot::Sender<Result<Value>>,
}
pub struct Database {
    sender: mpsc::Sender<Request>,
}
impl Database {
    pub fn start(path: &Path) -> Result<Self> {
        let path = path.to_owned();
        let (sender, receiver) = mpsc::channel::<Request>();
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("idea-database".into())
            .spawn(move || {
                let mut store = match Store::open(&path) {
                    Ok(s) => {
                        let _ = ready_tx.send(Ok(()));
                        s
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                for request in receiver {
                    let _ = request
                        .reply
                        .send(store.execute(&request.operation, request.input));
                }
            })?;
        ready_rx
            .recv()
            .map_err(|_| AppError::new("storage", "The library could not be opened."))??;
        Ok(Self { sender })
    }
    pub async fn call(&self, operation: &str, input: Value) -> Result<Value> {
        let (reply, receive) = tokio::sync::oneshot::channel();
        self.sender
            .send(Request {
                operation: operation.into(),
                input,
                reply,
            })
            .map_err(|_| {
                AppError::new(
                    "storage",
                    "The library is unavailable. Your text is still here.",
                )
            })?;
        receive.await.map_err(|_| {
            AppError::new(
                "storage",
                "The save could not be confirmed. Retry with your current text.",
            )
        })?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn filled(s: &mut Store, text: &str) -> Draft {
        let mut d = s.draft().unwrap();
        d.text = text.into();
        d.sequence += 1;
        d
    }
    #[test]
    fn atomic_commit_and_idempotent_retry_retire_draft() {
        let mut s = Store::memory();
        let mut d = filled(&mut s, "A thought\n  and a poem 🌱");
        d.links
            .push(reference(&id(), "https://example.com/a?q=1#verse").unwrap());
        let idea = s.commit(d.clone()).unwrap();
        assert_eq!(idea.capture_text, d.text);
        assert_eq!(idea.body, body_from_capture(&d.text));
        assert_eq!(idea.links.len(), 1);
        assert_eq!(s.commit(d.clone()).unwrap().id, idea.id);
        assert!(s.save_draft(d).is_err());
        assert_eq!(s.list(&json!({})).unwrap()["total"], 1);
        assert_ne!(s.draft().unwrap().id, idea.id);
    }
    #[test]
    fn capture_prefix_assigns_existing_tags_and_creates_new_types() {
        let mut s = Store::memory();
        let mut d = filled(&mut s, "[pOeM] a small line");
        let poem = s.commit(d.clone()).unwrap();
        assert_eq!(poem.capture_text, "a small line");
        assert_eq!(
            poem.tags
                .iter()
                .map(|tag| (tag.axis.as_str(), tag.name.as_str()))
                .collect::<Vec<_>>(),
            vec![("type", "Poem")]
        );
        assert_eq!(s.commit(d).unwrap().id, poem.id);

        let topic = s
            .save_tag("create_tag", &json!({"name":"Memory","axis":"topic"}))
            .unwrap();
        d = filled(&mut s, "[MEMORY] an old letter");
        let memory = s.commit(d).unwrap();
        assert_eq!(memory.capture_text, "an old letter");
        assert_eq!(memory.tags[0].id, topic["id"]);

        d = filled(&mut s, "[Sketchbook] draw the doorway");
        let first_sketch = s.commit(d).unwrap();
        assert_eq!(first_sketch.capture_text, "draw the doorway");
        assert_eq!(first_sketch.tags[0].axis, "type");
        assert_eq!(first_sketch.tags[0].name, "Sketchbook");
        d = filled(&mut s, "[sKeTcHbOoK] draw the window");
        let second_sketch = s.commit(d).unwrap();
        assert_eq!(second_sketch.tags[0].id, first_sketch.tags[0].id);

        assert_eq!(
            capture_tag_directive("[  ] ordinary thought"),
            (None, "[  ] ordinary thought".into())
        );
        assert_eq!(capture_tag_directive("[Poem"), (None, "[Poem".into()));
    }
    #[test]
    fn late_draft_and_discard_cannot_resurrect_text_or_links() {
        let mut s = Store::memory();
        let mut old = filled(&mut s, "old");
        old.links
            .push(reference(&id(), "https://example.com").unwrap());
        s.save_draft(old.clone()).unwrap();
        let mut new = old.clone();
        new.sequence += 1;
        new.text = "new".into();
        new.links.clear();
        s.save_draft(new.clone()).unwrap();
        assert_eq!(s.save_draft(old).unwrap_err().code, "stale_draft");
        assert!(s.draft().unwrap().links.is_empty());
        s.discard(&new.id).unwrap();
        assert!(s.save_draft(new).is_err());
        assert!(s.draft().unwrap().text.is_empty());
    }
    #[test]
    fn failed_transaction_preserves_recoverable_draft() {
        let mut s = Store::memory();
        let d = filled(&mut s, "Keep me");
        s.conn.execute_batch("CREATE TRIGGER fail_commit BEFORE INSERT ON ideas BEGIN SELECT RAISE(ABORT,'injected disk error'); END;").unwrap();
        assert!(s.commit(d.clone()).is_err());
        assert_eq!(s.draft().unwrap().text, d.text);
        assert_eq!(s.list(&json!({})).unwrap()["total"], 0);
    }
    #[test]
    fn body_and_state_writes_are_isolated_and_conflicts_preserve_content() {
        let mut s = Store::memory();
        let d = filled(&mut s, "spark");
        let i = s.commit(d).unwrap();
        s.set_state("set_starred", &json!({"id":i.id,"enabled":true}))
            .unwrap();
        assert!(s
            .update(&json!({"id":i.id,"revision":i.revision,"title":"stale"}))
            .is_err());
        let current = s.idea(&i.id).unwrap();
        let body = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"  line one","marks":[{"type":"bold"}]},{"type":"hardBreak"},{"type":"text","text":"line two 🌱"}]}]});
        s.update(&json!({"id":i.id,"revision":current.revision,"body":body}))
            .unwrap();
        let saved = s.idea(&i.id).unwrap();
        assert_eq!(saved.body, body);
        assert!(saved.starred_at.is_some());
        assert_eq!(saved.capture_text, "spark");
        s.set_state("set_archived", &json!({"id":i.id,"enabled":true}))
            .unwrap();
        s.set_state("set_archived", &json!({"id":i.id,"enabled":false}))
            .unwrap();
        assert!(s.idea(&i.id).unwrap().starred_at.is_some());
    }
    #[test]
    fn migration_moves_legacy_capture_text_into_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite3");
        let legacy_id = id();
        let capture = "First thought\n\nA quieter second thought";
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(include_str!("../migrations/001.sql"))
                .unwrap();
            conn.execute(
                "INSERT INTO ideas(id,capture_text,body_json,body_schema_version,created_at,content_updated_at,updated_at,revision,search_text,capture_fingerprint) VALUES(?1,?2,?3,1,1,1,1,1,?2,'legacy')",
                params![legacy_id, capture, empty_body().to_string()],
            )
            .unwrap();
        }
        let s = Store::open(&path).unwrap();
        let migrated = s.idea(&legacy_id).unwrap();
        assert_eq!(migrated.capture_text, capture);
        assert_eq!(migrated.body, body_from_capture(capture));
        assert_eq!(
            s.conn
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn url_validation_dedup_and_meaningful_differences() {
        assert!(reference(&id(), "javascript:alert(1)").is_err());
        assert!(reference(&id(), "https://example.com https://other.test").is_err());
        assert!(reference(&id(), "https://user:secret@example.com").is_err());
        let a = reference(&id(), " https://EXAMPLE.com:443/a?q=1#x ").unwrap();
        let b = reference(&id(), "https://example.com/a?q=2#x").unwrap();
        assert_ne!(a.key, b.key);
        assert_eq!(a.hostname, "example.com");
    }
    #[test]
    fn tag_axes_search_and_export_preserve_relationships() {
        let mut s = Store::memory();
        let d = filled(&mut s, "Café? a quiet poem");
        let i = s.commit(d).unwrap();
        let tag = s
            .save_tag("create_tag", &json!({"name":"Memory","axis":"topic"}))
            .unwrap();
        assert!(s
            .save_tag("create_tag", &json!({"name":" memory ","axis":"topic"}))
            .is_err());
        s.set_tag(&json!({"id":i.id,"tagId":tag["id"],"enabled":true}))
            .unwrap();
        assert_eq!(
            s.list(&json!({"query":"CAFE\u{301}?","topics":[tag["id"]]}))
                .unwrap()["total"],
            1
        );
        let export = s.export().unwrap();
        assert_eq!(export["ideas"][0]["tags"][0]["name"], "Memory");
        assert_eq!(export["ideas"][0]["captureText"], "Café? a quiet poem");
    }
    #[test]
    fn deleting_a_type_removes_its_assignments_but_keeps_ideas() {
        let mut s = Store::memory();
        let draft = filled(&mut s, "a tiny film");
        let idea = s.commit(draft).unwrap();
        let tag = s
            .save_tag("create_tag", &json!({"name":"Film","axis":"type"}))
            .unwrap();
        s.set_tag(&json!({"id":idea.id,"tagId":tag["id"],"enabled":true}))
            .unwrap();
        assert_eq!(s.tag_usage(&json!({"id":tag["id"]})).unwrap()["ideas"], 1);
        let deleted = s.delete_tag(&json!({"id":tag["id"]})).unwrap();
        assert_eq!(deleted["ideas"], 1);
        let saved = s.idea(&idea.id).unwrap();
        assert_eq!(saved.capture_text, "a tiny film");
        assert!(saved.tags.is_empty());
        assert!(!s
            .tags()
            .unwrap()
            .iter()
            .any(|candidate| candidate.id == tag["id"]));

        let topic = s
            .save_tag("create_tag", &json!({"name":"Cinema","axis":"topic"}))
            .unwrap();
        assert!(s.delete_tag(&json!({"id":topic["id"]})).is_err());
    }
    #[test]
    fn restart_and_newer_database_safety() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let mut s = Store::open(&path).unwrap();
        let d = filled(&mut s, "survives restart");
        s.save_draft(d).unwrap();
        drop(s);
        let mut s = Store::open(&path).unwrap();
        assert_eq!(s.draft().unwrap().text, "survives restart");
        s.conn.pragma_update(None, "user_version", 99).unwrap();
        drop(s);
        assert!(Store::open(&path).is_err());
        assert_eq!(
            Connection::open(path)
                .unwrap()
                .query_row("SELECT count(*) FROM capture_draft", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn unsupported_body_is_rejected() {
        assert!(body_text(&json!({"type":"doc","content":[{"type":"image"}]}), 1).is_err());
        assert!(body_text(&empty_body(), 2).is_err());
    }

    #[test]
    fn five_thousand_ideas_remain_searchable_with_combined_filters() {
        let mut s = Store::memory();
        let tx = s.conn.transaction().unwrap();
        for n in 0..5000 {
            tx.execute("INSERT INTO ideas(id,capture_text,body_json,body_schema_version,created_at,content_updated_at,updated_at,revision,search_text,capture_fingerprint) VALUES(?1,?2,?3,1,?4,?4,?4,1,?2,'fixture')", params![id(), format!("weekend project {n} café"), empty_body().to_string(), n]).unwrap();
        }
        tx.commit().unwrap();
        let started = std::time::Instant::now();
        let result = s
            .list(&json!({"query":"project 49","sort":"oldest","limit":60}))
            .unwrap();
        let elapsed = started.elapsed();
        assert_eq!(result["total"], 111);
        assert_eq!(result["ideas"].as_array().unwrap().len(), 60);
        assert!(
            elapsed < std::time::Duration::from_millis(150),
            "search took {elapsed:?}"
        );
        eprintln!("5000-idea search including 60 records: {elapsed:?}");
    }
    #[test]
    fn browse_filters_combine_missing_type_topics_links_and_dates() {
        let mut s = Store::memory();
        let mut notes = vec![];
        for n in 0..4 {
            let d = filled(&mut s, &format!("thought {n}"));
            notes.push(s.commit(d).unwrap());
        }
        let topic = s
            .save_tag("create_tag", &json!({"name":"Memory","axis":"topic"}))
            .unwrap();
        let kind = s
            .save_tag("create_tag", &json!({"name":"Recipe","axis":"type"}))
            .unwrap();
        for i in [0, 1, 2] {
            s.set_tag(&json!({"id":notes[i].id,"tagId":topic["id"],"enabled":true}))
                .unwrap();
        }
        s.set_tag(&json!({"id":notes[1].id,"tagId":kind["id"],"enabled":true}))
            .unwrap();
        for i in [0, 1] {
            let link = reference(&id(), "https://example.com/memory").unwrap();
            s.edit_link("add_link", &json!({"id":notes[i].id,"link":link}))
                .unwrap();
        }
        assert_eq!(
            s.list(&json!({"noType":true,"topics":[topic["id"]]}))
                .unwrap()["total"],
            2
        );
        assert_eq!(
            s.list(&json!({"noType":true,"types":[kind["id"]],"topics":[topic["id"]]}))
                .unwrap()["total"],
            3
        );
        let result = s
            .list(&json!({"noType":true,"hasLinks":true,"topics":[topic["id"]]}))
            .unwrap();
        assert_eq!(result["total"], 1);
        assert_eq!(result["ideas"][0]["id"], notes[0].id);
        s.conn
            .execute(
                "UPDATE ideas SET created_at=100 WHERE id=?1",
                [&notes[0].id],
            )
            .unwrap();
        assert_eq!(s.list(&json!({"from":100,"to":101})).unwrap()["total"], 1);
        assert_eq!(s.list(&json!({"from":99,"to":100})).unwrap()["total"], 0);
    }
    #[test]
    fn pocket_uses_active_library_and_avoids_immediate_repeats() {
        let mut s = Store::memory();
        assert!(s.random_idea(&json!({})).unwrap().is_null());
        let d = filled(&mut s, "keep this one");
        let first = s.commit(d).unwrap();
        for _ in 0..60 {
            let d = filled(&mut s, "archived");
            let idea = s.commit(d).unwrap();
            s.set_state("set_archived", &json!({"id":idea.id,"enabled":true}))
                .unwrap();
        }
        assert_eq!(
            s.random_idea(&json!({"query":"unrelated","offset":12}))
                .unwrap()["id"],
            first.id
        );
        assert!(s
            .random_idea(&json!({"exclude":first.id}))
            .unwrap()
            .is_null());
        let d = filled(&mut s, "another");
        let second = s.commit(d).unwrap();
        assert_eq!(
            s.random_idea(&json!({"exclude":first.id})).unwrap()["id"],
            second.id
        );
        assert_eq!(
            s.random_idea(&json!({"exclude":second.id})).unwrap()["id"],
            first.id
        );
    }
    #[test]
    fn new_preferences_preserve_existing_shortcuts_and_persist_pocket_choice() {
        let mut s = Store::memory();
        s.execute(
            "set_settings",
            json!({"shortcut":"Command+N","doubleCommand":true}),
        )
        .unwrap();
        let mut settings = s.settings().unwrap();
        assert_eq!(settings["shortcut"], "Command+N");
        assert_eq!(settings["doubleCommand"], true);
        assert_eq!(settings["pocketIdeas"], true);
        settings["pocketIdeas"] = json!(false);
        s.execute("set_settings", settings).unwrap();
        assert_eq!(s.settings().unwrap()["pocketIdeas"], false);
    }
}
