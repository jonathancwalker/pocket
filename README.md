# Pocket

Pocket is a small macOS app for catching an idea before it disappears, then returning to expand on it later.

## Intended audience

Pocket is for anyone with something they wanna come back to- students, writers, makers, anyone!
## Problem and opportunity

Opening an unstructured notes app or finding a physical journal adds enough friction for a fleeting thought to be lost, but Pocket makes first capture quick/low effort, then provides space to add writing, links, tags, and a other details when time allows.

## Primary user flow

Use Pocket’s global shortcut to open a small paper capture surface, write an idea, and save it. Later, open the library to search or browse ideas; add rich-text detail and references; apply Type or Topic tags; star ideas to revisit; and archive finished ones.

## Technical stack

- **Desktop:** Tauri 2 and Rust
- **Interface:** React, TypeScript, Vite, CSS, Lucide, and Tiptap
- **Data:** local SQLite on the user’s Mac

## API used

Pocket optionally uses the OpenAI API with a user-provided key to create a short title for each new capture. If no key is supplied, there's fallback naming conventions to differentiate ideas until the user gives them a more suitable name.

## Run locally

Requires Node 22.12 or newer, Rust stable, and Apple’s Command Line Tools.

## Public release

[Download Pocket v0.1.0](https://github.com/jonathancwalker/pocket/releases/tag/v0.1.0)

## Known limitations

- Pocket is currently macOS-only, local-first, and does not sync across devices.
- The current build is ad-hoc signed, so macOS may require recipients to Control-click and choose **Open** on first launch.
- Automatic titles require an OpenAI API key and an internet connection.

## Next improvements

Hosting a DB so I can sync across devices, browser-based and mobile capture support, Keychain-backed API-key storage (my local version is NOT secure lol), semantic search for ideas, adding attachments, and more official mac release!
