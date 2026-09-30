# Pocket

Pocket is a small macOS app for catching an idea before it disappears, then returning to develop it later.

## Intended audience

Pocket is for students, writers, makers, and anyone who has ideas away from their usual notes system and wants a lighter way to hold onto them.

## Problem and opportunity

Opening a full notes app or finding a physical journal adds enough friction for a fleeting thought to be lost. Pocket makes first capture quick, then provides space to add writing, links, tags, and a little structure when there is more time.

## Primary user flow

Use Pocket’s global shortcut to open a small paper capture surface, write an idea, and save it. Later, open the library to search or browse ideas; add rich-text detail and references; apply Type or Topic tags; star ideas to revisit; and archive finished ones.

## Technical stack

- **Desktop:** Tauri 2 and Rust
- **Interface:** React, TypeScript, Vite, CSS, Lucide, and Tiptap
- **Data:** local SQLite on the user’s Mac

## API used

Pocket optionally uses the OpenAI API with a user-provided key to create a short title for each new capture. Title generation happens after the idea is saved, so a failed or unavailable request simply leaves Pocket’s local fallback title in place.

## Run locally

Requires Node 22.12 or newer, Rust stable, and Apple’s Command Line Tools.

```sh
npm ci
npm run desktop
```

To create a shareable Mac build:

```sh
npm run package:dmg
```

This creates `dist/Pocket-<version>.dmg`.

## Public release

[Download Pocket v0.1.0](https://github.com/jonathancwalker/pocket/releases/tag/v0.1.0)

## Known limitations

- Pocket is currently macOS-only, local-first, and does not sync across devices.
- The current build is ad-hoc signed, so macOS may require recipients to Control-click and choose **Open** on first launch.
- Automatic titles require an OpenAI API key and an internet connection.

## Next improvements

Hosted sync, browser and mobile capture, Keychain-backed API-key storage, semantic search, attachments, and a notarized macOS release.
