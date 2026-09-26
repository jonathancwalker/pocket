use crate::storage::{AppError, Result};
use keyring::{Entry, Error as KeyringError};
use serde_json::{json, Value};
use std::time::Duration;

const SERVICE: &str = "com.jowalker.pocket";
const ACCOUNT: &str = "openai-api-key";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|_| AppError::new("keychain", "Pocket could not access your system keychain."))
}

pub fn has_api_key() -> Result<bool> {
    Ok(entry()?
        .get_password()
        .is_ok_and(|key| !key.trim().is_empty()))
}

pub fn save_api_key(key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::new(
            "validation",
            "Paste an OpenAI API key to save it.",
        ));
    }
    entry()?.set_password(key).map_err(|_| {
        AppError::new(
            "keychain",
            "Pocket could not save your API key to the system keychain.",
        )
    })
}

pub fn clear_api_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err(AppError::new(
            "keychain",
            "Pocket could not remove your API key from the system keychain.",
        )),
    }
}

pub fn api_key() -> Result<String> {
    let key = entry()?
        .get_password()
        .map_err(|_| AppError::new("keychain", "No OpenAI API key is saved in Pocket settings."))?;
    if key.trim().is_empty() {
        return Err(AppError::new(
            "keychain",
            "No OpenAI API key is saved in Pocket settings.",
        ));
    }
    Ok(key)
}

pub async fn generate(capture: &str) -> Result<String> {
    let key = api_key()?;
    let context: String = capture.chars().take(6_000).collect();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| AppError::new("title", "Pocket could not prepare an automatic title."))?;
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&json!({
            "model": "gpt-6-luna",
            "reasoning": {"effort": "none"},
            "max_output_tokens": 40,
            "store": false,
            "instructions": "Write one specific, concise title for this captured idea. Return only the title, with no quotation marks, markdown, or ending punctuation. Use at most 60 characters.",
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
    use super::clean;

    #[test]
    fn title_cleaning_keeps_one_short_line() {
        assert_eq!(
            clean("  “A small, bright plan”  "),
            Some("A small, bright plan".into())
        );
        assert_eq!(clean("\n\t"), None);
        assert_eq!(clean(&"a".repeat(90)).unwrap().chars().count(), 60);
    }
}
