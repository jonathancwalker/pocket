# Implementation verification

September 20, 2026 · Apple silicon Mac · macOS 15.6

## Recorded checks

- TypeScript checking and Vite production build pass.
- Nineteen frontend unit tests pass: reference validation/identity, exact readable poetry text, serialized mutations, retry after a rejected write, URL paste intent, shortcut recording/keycaps, non-repeating prompts, relative age, derived previews, and local calendar date boundaries.
- Sixteen Rust tests pass: transaction rollback, idempotent commit, draft ordering/retirement, field isolation/revision conflicts, URL validation, tag normalization, Unicode search, export relationships, restart/newer-database safety, body schema rejection, gesture logic, shortcut repeat/release timing, the 5,000-idea search fixture, composed Type/No type/Topic/link/date filters, whole-library random selection without immediate repeats, and preference backfill.
- Rust Clippy passes with warnings treated as errors. Rustfmt and Prettier checks pass.
- Dependency installation reports zero npm advisories after updating the test runner. JavaScript dependencies are pinned and both dependency lockfiles are included.
- The release Tauri build produces `src-tauri/target/release/bundle/macos/Pocket.app`, approximately 15 MB, with the test driver excluded.
- The local app bundle is ad-hoc signed and passes `codesign --verify --deep --strict`. The packaging script repeats the signing/verification step on future builds.
- The release bundle was opened through Launch Services. Its real accessibility interface confirms an empty personal library, keyboard capture via Command–N, immediate text entry without losing the first character, and Escape returning to the library. The temporary typing check was cleared.
- After the visual revision, the updated release was reopened with both existing personal ideas intact. The native window screenshot and accessibility tree confirm the compact frosted capture, focused input, three icon controls, and removal of decorative text. No test ideas were added to the personal library.
- The September 20 release was reopened with five personal ideas intact. Its native shortcut recorder accepted a real Command–N chord, displayed Command/N keycaps, and ended recording on key release without invoking capture. The unsaved recording was dismissed; the personal shortcut preference was preserved.
- The later tuck revision passes the full native suite and external-app focus regression. Its signed release was reopened with all 14 current personal ideas intact; animation samples were created only in the isolated test library.

The linen library release was packaged, ad-hoc signed, reopened, and visually inspected in the native window. All 16 personal ideas remained intact: a read-only digest of ideas, tags, tag assignments, and links matched before testing and after reopening. Sample data was written only to isolated test libraries. The updated release shows the full browsing page, List/Grid controls, filters, pagination, and the stitched pocket.

## Native desktop checks

`scripts/desktop-test.mjs` drives the actual WKWebView application with bundled frontend assets and an isolated SQLite database. It verifies:

1. Library launch and capture input focus; compact capture is an 86-point paper slip inside a 110-point transparent window. Multiline input expands it, removing lines shrinks it, and invalid-link feedback stays within the window.
2. Multiline draft autosave with indentation, blank lines, and emoji.
3. Invalid link feedback with focus retained, valid-link persistence, and the filled-dot confirmation.
4. Opening the book preserves the draft without creating an idea; reopening capture recovers it.
5. Save creates one idea and clears the committed draft.
6. Formatted writing and its title autosave; bold formatting and the original capture survive.
7. Multiple Type assignments, type rename/color preservation, starring, archive/restore, and body search with an empty-result case.
8. An injected database trigger rejects a capture commit. The UI retains the text, displays an error, creates no idea, and does not play the success animation.
9. Graceful quit/relaunch preserves writing, references, tags, star/archive state, and an unfinished draft.
10. Forced process termination after acknowledged writes preserves committed data and the persisted draft.
11. A delayed blur dismissal does not hide a focused capture window; 50 rapid open/dismiss cycles complete. This guards the focus race found while checking the compact interface.
12. Each invocation changes the placeholder. Two distinct shortcut presses open the library while a held-key repeat does not. The integration test feeds the same native router through commands compiled only with the `webdriver` feature; this does not synthesize physical global-hotkey events.
13. A full URL pasted into the text field becomes a saved link dot. The immediate second paste inserts text while retaining one reference. Mixed prose remains text, and both automatic and explicit links remain inspectable/removable.
14. After a successful SQLite commit, the full notebook slip folds to roughly 80 points wide and drops behind a stitched pocket over 1.9 seconds. There is no center crease line or native glass beneath the paper. Native WKWebView samples verify visible folding and travel, the pocket's settling motion, and enough window height for the pocket and shadow. The rendered animations finish before the check appears. The completed check holds for a second, then the native window fades over 280 ms. Opacity/geometry samples verify the native surface does not reset while visible and stays at zero alpha until the fresh field is ready. `test-results/capture-tuck.json` records the gesture; `test-results/capture-completion.json` records the fade and invisible reset. Failure retains the draft and never reaches the tuck/checkmark.
15. The linen List shows explicit titles and relative creation age. Untitled captures show Untitled plus a derived excerpt in a compact row no taller than 65 points; titled ideas remain single-line. Grid uses previews from existing writing, without a subtitle field. Type labels contain text, and neither layout shows link counts.
16. Recording a chord renders keycaps, waits for modifier release, registers and persists the chosen shortcut, and supports Escape cancellation. Test settings are restored afterward.
17. Invoking capture during the tuck or checkmark hold skips the remaining decoration; invoking during the native fade queues a fresh, focused field. The old completion never dismisses the new capture. A double shortcut during the fade opens the library and keeps capture hidden.
18. The external-app focus regression (`IDEA_CAPTURE_FOCUS_TEST=1 npm run test:desktop`) starts with another app in front of the library, then saves and dismisses capture. Native `NSWindowDidBecomeKeyNotification` counts must not increase for the library, and the original app must regain focus. The old implementation failed this check (one unwanted library activation); the corrected asynchronous handoff passes for both save and Escape. Results are recorded in `test-results/capture-focus.json`.

19. `IDEA_CAPTURE_LIBRARY_TEST=1 npm run test:desktop` creates 60 isolated ideas (54 active, 6 archived), including custom Recipe types, topics, untitled captures, and references. It checks 12-item List/Grid pages, starring from the list, return to the same page/layout after an acknowledged edit, Type plus No type composition, Has links, local Today filtering, and empty results. The pocket selects from the full active database despite an empty search, offers another idea, opens the editor, and preserves the browsing context. Its setting persists; in keepsake mode keyboard focus uses the hover invitation without exposing the slip, click reveals it, and it returns to concealment after three seconds. Light and dark screenshots use the app's own palette rules in the isolated webview without altering macOS appearance.

20. The restored editor sidebar was verified in the 60-idea native library fixture. All 54 active notes are available independently of the 12-item browse page, with rows at most 40 points high, live title updates, and selected-note stitching. Switching flushes a pending edit before opening the target. An injected SQLite update failure blocks the switch and retains the current writing; removing the failure and switching retries the save successfully. Command–F targets sidebar search; filtering keeps an out-of-result current note available. The sidebar inherits a browse Type filter, can independently reset to all ideas, and returning to the browser preserves its original filter, page, and layout. `test-results/linen-editor-sidebar.png` records the restored view.

21. The continuous editor layout was checked in the native WKWebView at 800×560, 1120×780, and 1600×1000. The sidebar and its pocket footer reach the window bottom; the paper pane reaches the top-bar seam, right edge, and bottom without a global footer strip. A long title reflows on native window resize without clipping, and the page, editor, and toolbar have no horizontal overflow. Both the last sidebar idea and the Links section remain reachable by scrolling. Screenshots in `test-results/linen-editor-{compact,regular,large}.png` and `linen-editor-compact-scrolled.png` record the layouts.

22. At the minimum window size, the relocated pocket's random-idea preview remains visible and clickable across the sidebar edge; its stacking was verified with hit testing and `test-results/linen-editor-pocket.png`. Compact dark editor and browsing views were also inspected (`linen-editor-compact-dark.png`, `linen-browse-compact-dark.png`). The 60-idea library suite and all 19 frontend tests pass after the layout revision.

The continuous-layout release was packaged and signature-verified, then reopened and visually inspected with an existing personal note in both the regular native window and macOS full screen. A fresh read-only digest confirms all 16 personal ideas, tags, assignments, links, and app settings match the snapshot taken before testing.

23. Sidebar Type color bars use the same palette as the library labels, with named accessible alternatives. The native 60-idea fixture verifies standard and custom types, no marker for a topic-only idea, two distinct segments after adding a second type, and immediate removal after removing it. The full library suite, including the three native window sizes, passes. `test-results/linen-editor-compact-dark.png` records the bars in the compact editor.

24. `IDEA_CAPTURE_PAPER_TEST=1 npm run test:desktop` checks the actual paper surface with both palette rules, without changing macOS appearance. Twelve lines scroll inside the eight-line maximum textarea while keeping the save control visible. The reduced-motion path is exercised by overriding that media preference only in the isolated webview: no fold/draw animations run, the complete check and pocket fit in the native window, one idea is committed, and the window fades away. Native screenshots are recorded in `test-results/capture-paper-{light,dark,reduced-motion}.png`. The complete capture suite, 19 frontend tests, 16 Rust tests, and external-app focus regression pass for the paper revision.

The paper release was packaged, signature-verified, reopened, and inspected through its native accessibility tree and screenshot. Capture has the ruled paper, margin, torn edge, stitched save button, and focused input. All 16 personal ideas, tags, assignments, references, and settings match the pre-test read-only snapshot. No samples were added to the personal library.

The user's screen recording exposed a separate focus flash at 10.15 seconds: the library briefly became key after the circle faded. Opacity/geometry checks alone did not cover it. Closing now waits for macOS to finish returning activation before ordering capture out; otherwise AppKit can promote the library for one frame. The one-second check hold and 280 ms fade are unchanged.

25. The Pocket branding release updates the application/display name, native window and menu labels, browser title, export filename, and main library heading. The Pocket note SVG generates the application icons and a separate monochrome menu-bar glyph. The sort dropdown is removed from both browse layouts; the default newest-first order is retained. The 19 frontend tests, production build, 60-idea native library suite, and compact-window checks pass. The signed `Pocket.app` was reopened and visually inspected; its bundle icon matches the newly generated ICNS. All 17 personal ideas, tags, assignments, references, and settings match a fresh pre-update snapshot. The original bundle identifier and database directory remain unchanged.

26. The browsing header uses less vertical padding and a smaller gap between its title/search and view controls. Its unfiltered brown area, including window chrome, is approximately 24% shorter (about 178 to 135 logical points); text and control sizes are unchanged. The existing 60-idea native library suite passes, including compact browsing and editor layouts. The signed app was reopened with all 18 personal ideas and settings matching a fresh pre-update snapshot.

27. Search is grouped immediately before Filter on the browsing toolbar, with a 220-point preferred width and the same 35-point height as the view/filter controls. Responsive styles let the tool group wrap and give search a full row on very narrow layouts. The existing 60-idea native library suite passes, including search/filter behavior and the 800×560 compact layout; the compact dark screenshot shows all toolbar controls aligned without overlap. The signed release was reopened, Command–F visibly focused the relocated search, and all 18 personal ideas and settings match the pre-update snapshot.

The test artifacts are generated in `test-results/`; the sample ideas exist only in `.local-data/desktop-test-*`. They are not installed in the personal-use library.

## Performance

The Rust debug test searches 5,000 ideas and loads 60 matching complete records in approximately 5.8 ms on this Mac. This is an in-memory fixture measurement, not a claim about every disk or library size.

A 50-sample native debug run after the September 20 tuck revision measured approximately **11.9 ms p95** from the request to a focused warm capture field and **4.4 ms p95** for a draft write acknowledgment. These include localhost test-driver round trips; they are not isolated renderer or storage timings. The script records the raw summary in `test-results/desktop-result.json`. The later linen-library regression run recorded approximately **114.9 ms p95** to focused capture and **5.3 ms p95** per acknowledged draft write. These measurements include the runner’s 100 ms polling interval and local round trips. The paper submission animation lasts about 3.36 seconds when storage is fast: 1.9 seconds to fold and tuck, 180 ms to draw the check, a one-second hold, and a 280 ms native fade. Slower writes keep the paper available in its waiting state until commit; the tuck never signals success before storage acknowledges it. Reduce Motion bypasses folding/tucking/drawing, retains the one-second hold, and uses a 120 ms native opacity fade. A new capture/library request skips the remaining tuck or hold.



## Manual checks and limits

- Double-Command is implemented and its isolated-tap state machine is unit-tested. It remains opt-in; granting/revoking Accessibility permission and checking accidental activation during everyday shortcuts require a user session with that permission.
- Full-screen apps, multiple monitors, Stage Manager, sleep/wake, VoiceOver, and the user's preferred text scaling still need hands-on checks in their environment.
- The default shortcut is configurable. Registration failure is reported in Settings and the menu-bar doorway remains available.
- Settings reported no registration error for Command–Shift–Space. A synthetic shortcut sent to Calculator through computer automation did not open capture; physical global-hotkey behavior across apps therefore remains unverified. Command–N inside the release app and the native doorway exercised by the desktop test both work.
- The SQLite/JSON content paths are tested. Choosing an export destination and enabling launch at login are native system flows and are not exercised by the automated suite.
- Capture completion motion respects Reduce Motion. The automated suite verifies failure does not reach the success state; subjective animation feel remains a daily-use check.
- This is a local personal-use Mac build. It has not been signed/notarized for general distribution, and no Windows or mobile build has been validated.

The reference drawings remain in `docs/reference/`. The original Spotlight direction has evolved into ruled notebook paper for capture and mended linen for the library; the compact field, contextual link dots, plain labels, and quiet controls remain. Its original performance targets remain targets for real use.
