# Pocket

A local Mac app for capturing and developing ideas. Built with Tauri, React, TypeScript, Tiptap, and SQLite. The product specification is in [MVP-PLAN.md](MVP-PLAN.md).

## Use the app

Build a standalone application with `npm run package`. The result is `src-tauri/target/release/bundle/macos/Pocket.app`; open it in Finder or move it to Applications. The packaging script ad-hoc signs and verifies the local bundle. This personal-use build is not notarized for public distribution.

- **⌘⇧Space** is the default capture shortcut. In Settings, click the shortcut field and press the combination you want; keycaps show the recorded keys, then **Save** applies it. Escape cancels recording. Your existing saved shortcut is preserved across updates.
- Press your capture shortcut twice within **450 ms** to open the full library. You can keep the modifier held and tap the letter twice. Holding a key down does not count as a second press.
- **Enter** adds a line. **⌘Enter** saves the capture. Capture is a ruled notebook slip with a soft torn edge and a stitched save button. After the SQLite commit, the paper folds and tucks into a linen pocket over 1.9 seconds, without a center crease line. A check draws inside the pocket, holds for a full second, then fades away with the native window over 280 ms. Invoking capture again skips the remaining tuck or hold. Failed writes restore the draft; Reduce Motion skips the fold/tuck/drawing and uses a shorter opacity fade.
- Start a capture with **[Tag name]** to attach a tag as you save. Existing Type and Topic tags match regardless of case; a new name creates a Type tag. The bracketed tag is removed from the saved thought.
- Every capture receives a title immediately: **New idea #** without a tag, or **[Tag] Idea #** with one. In **Settings**, paste an OpenAI API key to let Pocket refine new titles in the background with `gpt-6-luna`. During local development, the key is stored in Pocket’s local app-data folder so it survives rebuilds; Keychain storage is a required migration before distribution. The request is not stored by OpenAI, and a missing key or failed request simply leaves the fallback title in place.
- **Esc** or clicking away preserves the unfinished draft. Clear its text and remove attached links to empty it.
- Click the **link icon**, then paste a complete `https://` or `http://` URL. A filled dot confirms that it is attached to the saved draft. Click a dot to inspect, copy, open, or remove it. More than five references use an overflow list.
- Pasting a complete URL directly into capture also attaches it. Paste that same URL again within **three seconds**, without intervening typing or cursor movement, to insert it as text. The attached link remains. Mixed prose stays as text; links are deduplicated.
- The **book** opens the library and preserves your draft. The **+** button resumes it.
- In the library, pick an idea to give it a title, write with the formatting toolbar, add resources, assign Type/Topic tags, or star/archive it. **⌘S** saves immediately; edits also autosave.
- Browse the linen library in **List** or **Grid**, with 12 ideas per page. List keeps titled ideas compact; untitled ideas include a short excerpt. Grid previews come from your existing writing, without an extra subtitle field. Your layout choice is remembered locally.
- Filter by **Type**, **Topic**, **Captured** date, **Has links**, or **No type**. Choices within one tag axis are combined with OR; separate axes and other filters are combined with AND. Type labels are plain stitched text, so custom types need no icon. List and Grid omit link counts.
- **All / Starred / Archive** work with search and filters. Ideas appear newest first; the sort dropdown is omitted from both List and Grid. Open an idea to write, then return to the same browsing page and layout.
- While editing, a compact sidebar shows single-line titles, stars, and relative ages. It starts with the same collection you were browsing, offers its own search (**⌘F**) and an **All ideas** reset, and loads up to 60 ideas per sidebar page. Switching notes saves pending writing first; a failed save keeps the current note open. **Library** returns to the original full-page filters, page, and List/Grid layout.
- Small color bars at the right of sidebar rows match each idea's Type tags. Multiple types share a segmented bar; ideas without a type leave the space empty. Hovering the row or using a screen reader gives the type names.
- The editor uses a continuous linen sidebar and paper writing surface, with the pocket anchored at the bottom of the sidebar. Titles wrap as the window narrows; each pane scrolls independently with soft edges. The writing column stays readable in a large window and adapts down to the native 800×560 minimum.
- Click the stitched **pocket** to pull a random active idea from the whole library, preview it, pull another, or open it. In **Settings → Ideas in the pocket**, turn this off for decorative keepsakes. Hover or keyboard focus gives a small wiggle and “Peek inside”; the slip stays hidden until you click. Keepsakes take three seconds to rise, linger, and tuck away. Reduce Motion keeps the reveal still.
- Capture and the library follow the Mac's light/dark appearance, with linen, sage, warm paper, and stitched labels.
- Close the library window and the app stays in the **menu bar**. Quit from its menu or the application menu to flush both windows first.

The optional double-Command gesture is off initially. Enabling it in Settings asks macOS for Accessibility permission. After granting permission, enable it again. The conventional shortcut works independently. Open at login is also optional and starts quietly.

## Develop

Requirements: Node 22.12 or newer, Rust stable, and Apple's Command Line Tools (`xcode-select --install`).

```sh
npm ci
npm run desktop
```

The scripts use the project-local Rust installation in `.tooling` when it exists, otherwise the Rust installation on your PATH. `.tooling` is ignored by Git and is not part of the application. The source can be built on another Mac with an ordinary Rust installation.

`npm run dev` serves only the frontend. This is a desktop app: the browser page explains how to launch it instead of silently storing ideas in a different browser database.

## Check and build

```sh
npm run check
npm test
npm run test:rust
npm run lint:rust
node scripts/cargo.mjs fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run test:desktop:build
npm run test:desktop
IDEA_CAPTURE_LIBRARY_TEST=1 npm run test:desktop
npm run package
```

The desktop test runs the real bundled interface in macOS WKWebView against real SQLite. It creates an isolated library under `.local-data/desktop-test-*`, opens app windows, writes only test ideas, and checks persistence across restart and forced termination. Close other running development copies first. Screenshots and results go to `test-results/`.

The library-only suite seeds 60 ideas in a separate test database and checks layouts, pagination, filtering, editing, and pocket behavior. It resizes the native window to 800×560, 1120×780, and 1600×1000 to check title wrapping, continuous pane geometry, content reachability, and overflow. Its screenshots use the actual light/dark palette rules without changing macOS appearance.

For the external-app focus regression, run `IDEA_CAPTURE_FOCUS_TEST=1 npm run test:desktop`, then switch to another app when prompted. It checks that saving and Escape return to that app without bringing the library forward, even for a single key-window notification.

The optional `webdriver` Cargo feature enables a localhost-only test driver. Normal development and `npm run package` do **not** enable it. Do not distribute a binary built with this feature.

## Your data and recovery

The personal-use database is normally:

```text
~/Library/Application Support/com.jowalker.ideacapture/ideas.sqlite3
```

Debug builds use the `development/` subdirectory. The exact active location is displayed in Settings. Tests override the location with `IDEA_CAPTURE_DATA_DIR`; they do not use your personal library.

Use **Settings → Export library** for a versioned JSON snapshot containing ideas, rich-text documents, references, Type colors, tags, state, timestamps, and the unfinished draft. Rich-text JSON is the canonical body; plain text is derived for searching. Export is for backup and portability; an interactive import/merge UI is outside this MVP.

The app creates a consistent SQLite backup before applying a migration to an existing database. It refuses to overwrite a damaged or newer database with an empty library.

To restore a SQLite backup, quit Pocket completely, preserve a copy of the current database, and replace `ideas.sqlite3` with the backup. Keep the original until you have reopened and checked the restored library. Do not replace a database while the app is running.

Normal close and quit flush edits. Force quit or power loss can lose text typed since the last completed autosave (initially 300 ms in capture and 500 ms in the library). A displayed “Saved” means the relevant write has completed. Write failures keep the current editor available and offer retry; the library also offers copying the writing.

## Implementation boundaries

- React handles the two interfaces. The library/editor bundle is loaded separately from capture.
- A narrow Tauri command layer checks the calling window. SQLite runs on one dedicated Rust worker and all SQL stays in Rust.
- Draft sequences and retired capture sessions reject delayed writes. Capture IDs make retries idempotent. Revision checks and serialized content writes protect library edits.
- AppKit integration is isolated in `src-tauri/src/platform/` for focus restoration, display placement, full-screen auxiliary behavior, library material, and the optional gesture. Capture starts as an 86-point paper slip within a transparent 110-point window and grows or shrinks with its content. The paper is opaque in both appearances; there is no native glass underneath its torn edge. Saving extends the transparent window downward for the pocket. Geometry resets only after the native fade and activation handoff have completed. Reduce Motion keeps the pocket still and shortens the fade.
- Stable UUIDs, a versioned body schema, explicit mutations, and SQL migrations prepare for a later authenticated sync service. The MVP has no cloud account or hosted dependency.

Windows, phone capture, hosted sync, semantic search, attachments, visualization, and automatic resurfacing remain future work. Native behavior over full-screen apps, Stage Manager, multiple displays, and double-Command permission changes should also be checked in your own setup.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for recorded validation and remaining manual checks.

The Pocket note app icon and matching menu-bar symbol are defined in `src-tauri/icons/source.svg` and `tray.svg`. Run `npm run icons` to regenerate their platform assets. The app retains its original bundle identifier and database location so existing libraries and settings remain available.
