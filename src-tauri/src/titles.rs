use crate::storage::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

pub const TITLE_MODEL: &str = "gpt-6-luna";
pub const TITLE_PROMPT: &str = "Write one specific, concise title for this captured idea. Return only the title, with no quotation marks, markdown, or ending punctuation. Use at most 60 characters.";
pub const TITLE_INPUT_LIMIT: usize = 6_000;

#[derive(Deserialize, Serialize)]
struct TitleSettings {
    openai_api_key: String,
}

fn read_api_key(path: &Path) -> Result<Option<String>> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(AppError::new(
                "title_settings",
                "Pocket could not read its local title settings.",
            ))
        }
    };
    let settings: TitleSettings = serde_json::from_str(&text).map_err(|_| {
        AppError::new(
            "title_settings",
            "Pocket could not read its local title settings.",
        )
    })?;
    let key = settings.openai_api_key.trim().to_string();
    Ok((!key.is_empty()).then_some(key))
}

pub fn has_api_key(path: &Path) -> Result<bool> {
    Ok(read_api_key(path)?.is_some())
}

pub fn save_api_key(path: &Path, key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::new(
            "validation",
            "Paste an OpenAI API key to save it.",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        AppError::new("title_settings", "Pocket could not save its local title settings.")
    })?;
    std::fs::create_dir_all(parent).map_err(|_| {
        AppError::new("title_settings", "Pocket could not save its local title settings.")
    })?;
    let temporary = path.with_file_name(format!(".title-settings-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        use std::io::Write;
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary)?;
        let text = serde_json::to_vec(&TitleSettings {
            openai_api_key: key.to_string(),
        })?;
        file.write_all(&text)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_| AppError::new("title_settings", "Pocket could not save its local title settings."))
}

pub fn clear_api_key(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(AppError::new(
            "title_settings",
            "Pocket could not remove its local title settings.",
        )),
    }
}

pub fn api_key(path: &Path) -> Result<String> {
    read_api_key(path)?.ok_or_else(|| {
        AppError::new("title_settings", "No OpenAI API key is saved in Pocket settings.")
    })
}

pub async fn generate(path: &Path, capture: &str) -> Result<String> {
    let key = api_key(path)?;
    let context: String = capture.chars().take(TITLE_INPUT_LIMIT).collect();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| AppError::new("title", "Pocket could not prepare an automatic title."))?;
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&json!({
            "model": TITLE_MODEL,
            "reasoning": {"effort": "none"},
            "max_output_tokens": 40,
            "store": false,
            "instructions": TITLE_PROMPT,
            "input": context,
        }))
        .send()
        .await
        .map_err(|_| AppError::new("title", "Pocket could not reach OpenAI for a title."))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "title",
            "OpenAI could not create a title this time.",
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| AppError::new("title", "OpenAI returned an unreadable title."))?;
    let text = value["output"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "message")
        .flat_map(|item| item["content"].as_array().into_iter().flatten())
        .find(|content| content["type"] == "output_text")
        .and_then(|content| content["text"].as_str())
        .unwrap_or_default();
    clean(text).ok_or_else(|| AppError::new("title", "OpenAI did not return a usable title."))
}

fn clean(title: &str) -> Option<String> {
    let title = title
        .trim()
        .trim_matches(['\'', '"', '“', '”'])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        return None;
    }
    Some(title.chars().take(60).collect())
}

#[cfg(test)]
mod tests {
    use super::{clear_api_key, clean, has_api_key, save_api_key};

    #[test]
    fn title_cleaning_keeps_one_short_line() {
        assert_eq!(
            clean("  “A small, bright plan”  "),
            Some("A small, bright plan".into())
        );
        assert_eq!(clean("\n\t"), None);
        assert_eq!(clean(&"a".repeat(90)).unwrap().chars().count(), 60);
    }

    #[test]
    fn local_title_settings_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("title-settings.json");
        assert!(!has_api_key(&path).unwrap());
        save_api_key(&path, " sk-test ").unwrap();
        assert!(has_api_key(&path).unwrap());
        clear_api_key(&path).unwrap();
        assert!(!has_api_key(&path).unwrap());
    }
}
