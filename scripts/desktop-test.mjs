import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const data = resolve('.local-data', `desktop-test-${Date.now()}`);
const artifacts = resolve('test-results');
const port = 46000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
let app,
  session,
  logs = '';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || result.error || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch (e) {
      last = e;
    }
    await pause(100);
  }
  throw new Error(`Timed out: ${label}${last ? `\n${last.message}` : ''}`);
}
async function evaluate(window, fn, ...args) {
  const script = `const done=arguments[arguments.length-1];(async()=>(${fn.toString()})(...${JSON.stringify(args)}))().then(value=>done({ok:true,value:value??null})).catch(error=>done({ok:false,error:String(error?.message||error)}));`;
  return request('/wdio/eval', 'POST', { window_label: window, script, timeout_ms: 15000 });
}
const invoke = (window, command, args = {}) =>
  evaluate(
    window,
    (command, args) => window.__TAURI_INTERNALS__.invoke(command, args),
    command,
    args,
  );
const db = (operation, input = null) => invoke('library', 'storage', { operation, input });
const click = (window, selector) =>
  evaluate(
    window,
    (selector) => {
      const button = document.querySelector(selector);
      if (!button) throw new Error(`Missing ${selector}`);
      if (button.disabled) throw new Error(`Disabled ${selector}`);
      button.click();
    },
    selector,
  );
const text = (window, selector) =>
  evaluate(window, (selector) => document.querySelector(selector)?.textContent, selector);
async function input(window, selector, value) {
  await evaluate(
    window,
    (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Missing ${selector}`);
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );
}
async function key(window, key, options = {}) {
  await evaluate(
    window,
    (key, options) => {
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, ...options }),
      );
    },
    key,
    options,
  );
}
async function screenshot(window, name) {
  await request(`/session/${session}/window`, 'POST', { handle: window });
  const png = await request(`/session/${session}/screenshot`);
  await writeFile(resolve(artifacts, name), Buffer.from(png, 'base64'));
}
async function resize(window, width, height) {
  await request(`/session/${session}/window`, 'POST', { handle: window });
  return request(`/session/${session}/window/rect`, 'POST', { x: 0, y: 30, width, height });
}
async function start() {
  app = spawn(resolve(root, 'src-tauri/target/debug/idea-capture'), [], {
    cwd: root,
    env: { ...process.env, IDEA_CAPTURE_DATA_DIR: data, TAURI_WEBDRIVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (d) => (logs += d));
  app.stderr.on('data', (d) => (logs += d));
  await until(() => request('/status'), 'desktop driver ready', 20000);
  const created = await request('/session', 'POST', { capabilities: { alwaysMatch: {} } });
  session = created.sessionId;
  await until(
    () => evaluate('library', () => !!document.querySelector('.library-shell')),
    'library rendered',
  );
}
async function stop(force = false) {
  if (!app || app.exitCode !== null) return;
  if (force) app.kill('SIGKILL');
  else {
    await invoke('library', 'window_action', { action: 'quit', height: null });
    await until(() => app.exitCode !== null, 'graceful quit', 8000);
  }
  await pause(300);
}
async function pasteLink(url) {
  await click('capture', '[aria-label="Attach a link"]');
  await until(
    () => evaluate('capture', () => !!document.querySelector('#paste-link')),
    'link input',
  );
  await evaluate(
    'capture',
    (url) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', url);
      document
        .querySelector('#paste-link')
        .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
    },
    url,
  );
}
async function pasteCapture(value) {
  return evaluate(
    'capture',
    (value) => {
      const field = document.querySelector('[aria-label="Your idea"]');
      field.focus();
      const transfer = new DataTransfer();
      transfer.setData('text/plain', value);
      const ordinaryPaste = field.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
      // Synthetic clipboard events have no browser default insertion.
      if (ordinaryPaste) document.execCommand('insertText', false, value);
      return ordinaryPaste;
    },
    value,
  );
}
function sql(statement) {
  execFileSync('python3', [
    '-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()',
    resolve(data, 'ideas.sqlite3'),
    statement,
  ]);
}

await mkdir(artifacts, { recursive: true });
await mkdir(data, { recursive: true });
try {
  await start();
  if (process.env.IDEA_CAPTURE_LIBRARY_TEST === '1') {
    const { checkLibrary } = await import('./library-test.mjs');
    await checkLibrary({
      db,
      invoke,
      evaluate,
      click,
      input,
      key,
      until,
      screenshot,
      resize,
      sql,
      pause,
    });
    await stop();
    process.exit(0);
  }
  if (process.env.IDEA_CAPTURE_PAPER_TEST === '1') {
    await click('library', '.new-idea-button');
    await until(
      () =>
        evaluate(
          'capture',
          () => document.activeElement?.getAttribute('aria-label') === 'Your idea',
        ),
      'paper editor ready',
    );
    await input(
      'capture',
      '[aria-label="Your idea"]',
      Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a thought worth keeping`).join('\n'),
    );
    await until(() => evaluate('capture', () => innerHeight > 300), 'long paper expands');
    assert.ok(
      await evaluate('capture', () => {
        const field = document.querySelector('textarea');
        return (
          field.clientHeight === 272 &&
          field.scrollHeight > field.clientHeight &&
          document.querySelector('.capture-save').getBoundingClientRect().bottom < innerHeight
        );
      }),
      'long captures scroll without losing their save button',
    );
    for (const theme of ['light', 'dark']) {
      await evaluate(
        'capture',
        (theme) => {
          const shell = document.querySelector('.capture-shell');
          // Copy the app's own palette, without changing macOS preferences.
          const apply = (rule) => {
            if (rule.selectorText === '.capture-shell')
              for (const prop of rule.style)
                if (prop.startsWith('--'))
                  shell.style.setProperty(prop, rule.style.getPropertyValue(prop));
          };
          for (const sheet of document.styleSheets)
            for (const rule of sheet.cssRules) {
              if (rule instanceof CSSStyleRule) apply(rule);
              if (
                theme === 'dark' &&
                rule instanceof CSSMediaRule &&
                rule.conditionText.includes('prefers-color-scheme: dark')
              )
                for (const style of rule.cssRules) apply(style);
            }
          shell.style.colorScheme = theme;
        },
        theme,
      );
      await screenshot('capture', `capture-paper-${theme}.png`);
    }
    await evaluate('capture', () => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query.includes('prefers-reduced-motion') ? { matches: true } : original(query);
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules)
          if (
            rule instanceof CSSMediaRule &&
            rule.conditionText.includes('prefers-reduced-motion: reduce')
          )
            rule.media.mediaText = 'all';
    });
    await click('capture', '.capture-save');
    await until(
      () => evaluate('capture', () => !!document.querySelector('.confirmation-check')),
      'reduced motion reaches the check',
    );
    assert.equal((await db('list_ideas', {})).total, 1);
    assert.ok(
      await evaluate('capture', () => {
        const pocket = document.querySelector('.tuck-pocket');
        const check = document.querySelector('.confirmation-check path');
        return (
          parseFloat(getComputedStyle(check).strokeDashoffset) === 0 &&
          pocket.getBoundingClientRect().bottom + 10 < innerHeight &&
          document
            .querySelector('.capture-scene')
            .getAnimations({ subtree: true })
            .filter((animation) => animation instanceof CSSAnimation).length === 0
        );
      }),
      'Reduce Motion shows a still pocket and complete check, with no folding or clipping',
    );
    await screenshot('capture', 'capture-paper-reduced-motion.png');
    await until(
      async () => !(await invoke('library', 'capture_surface')).visible,
      'reduced-motion save fades away',
    );
    console.log(
      'PASS: paper light/dark previews, long-input scrolling, pocket bounds, and reduced-motion save.',
    );
    await stop();
    process.exit(0);
  }
  if (process.env.IDEA_CAPTURE_FOCUS_TEST === '1') {
    console.log(
      'FOCUS_TEST_READY: switch to another app; this checks the library stays behind it.',
    );
    let externalPid = 0,
      externalSince = 0;
    const before = await until(
      async () => {
        const surface = await invoke('library', 'capture_surface');
        if (surface.frontmostPid <= 0 || surface.frontmostPid === app.pid) {
          externalPid = 0;
          return false;
        }
        if (externalPid !== surface.frontmostPid) {
          externalPid = surface.frontmostPid;
          externalSince = Date.now();
        }
        return Date.now() - externalSince >= 600 && surface;
      },
      'another app is frontmost',
      60000,
    );
    await invoke('library', 'window_action', { action: 'capture', height: null });
    await until(() => evaluate('capture', () => document.hasFocus()), 'external capture focus');
    const capturing = await invoke('library', 'capture_surface');
    await input('capture', '[aria-label="Your idea"]', 'External focus handoff regression');
    await click('capture', '[aria-label="Save idea · ⌘Enter"]');
    const after = await until(async () => {
      const surface = await invoke('library', 'capture_surface');
      return !surface.visible && surface.frontmostPid === before.frontmostPid && surface;
    }, 'save returns to the original external app');
    await writeFile(
      resolve(artifacts, 'capture-focus.json'),
      JSON.stringify({ before, capturing, after, logs }, null, 2),
    );
    assert.equal(
      after.libraryKeyEvents,
      before.libraryKeyEvents,
      'the library must never become key while returning to another app',
    );
    await invoke('library', 'window_action', { action: 'capture', height: null });
    await until(async () => {
      const surface = await invoke('library', 'capture_surface');
      return (
        surface.visible &&
        surface.alpha === 1 &&
        (await evaluate(
          'capture',
          () =>
            document.hasFocus() &&
            document.activeElement?.getAttribute('aria-label') === 'Your idea' &&
            !document.querySelector('textarea').disabled &&
            document.querySelector('.capture-shell').dataset.stage === 'editing',
        ))
      );
    }, 'fresh capture is visible and its editor accepts input');
    await key('capture', 'Escape');
    const dismissed = await until(async () => {
      const surface = await invoke('library', 'capture_surface');
      return !surface.visible && surface.frontmostPid === before.frontmostPid && surface;
    }, 'Escape returns to the original external app');
    assert.equal(
      dismissed.libraryKeyEvents,
      before.libraryKeyEvents,
      'Escape must not activate the library',
    );
    await writeFile(
      resolve(artifacts, 'capture-focus.json'),
      JSON.stringify({ before, capturing, after, dismissed }, null, 2),
    );
    console.log('PASS: external capture returns focus without a single library activation.');
    await stop();
    process.exit(0);
  }
  await screenshot('library', 'library-empty.png');
  console.log('PASS: native library boots with bundled assets and isolated SQLite storage.');
  await click('library', '.new-idea-button');
  await until(
    () =>
      evaluate('capture', () => document.activeElement?.getAttribute('aria-label') === 'Your idea'),
    'capture focuses immediately',
  );
  await until(() => evaluate('capture', () => innerHeight <= 110), 'compact native capture height');
  assert.equal(
    await evaluate('capture', () => document.querySelector('.capture-card').clientHeight),
    86,
  );
  assert.equal(
    (await invoke('library', 'capture_surface')).glassWidth,
    0,
    'no glass behind the paper',
  );
  await screenshot('capture', 'capture-compact.png');
  await input('capture', '[aria-label="Your idea"]', 'one\ntwo\nthree\nfour\nfive');
  await until(
    () => evaluate('capture', () => innerHeight > 160),
    'capture expands for multiline text',
  );
  await input('capture', '[aria-label="Your idea"]', 'one');
  await until(
    () => evaluate('capture', () => innerHeight <= 110),
    'capture shrinks when lines are removed',
  );
  console.log('PASS: compact capture expands and shrinks with its text.');
  await invoke('capture', 'window_action', { action: 'dismiss-blurred', height: null });
  assert.ok(await evaluate('capture', () => document.hasFocus()));
  const firstPrompt = await evaluate(
    'capture',
    () => document.querySelector('textarea').placeholder,
  );
  await key('capture', 'Escape');
  await invoke('library', 'window_action', { action: 'test-shortcut-down', height: null });
  await until(() => evaluate('capture', () => document.hasFocus()), 'first shortcut opens capture');
  assert.notEqual(
    await evaluate('capture', () => document.querySelector('textarea').placeholder),
    firstPrompt,
  );
  await invoke('library', 'window_action', { action: 'test-shortcut-down', height: null });
  assert.ok(await evaluate('capture', () => document.hasFocus()));
  await invoke('library', 'window_action', { action: 'test-shortcut-up', height: null });
  await invoke('library', 'window_action', { action: 'test-shortcut-down', height: null });
  await until(
    () => evaluate('library', () => document.hasFocus()),
    'second shortcut opens library',
  );
  await invoke('library', 'window_action', { action: 'test-shortcut-up', height: null });
  assert.equal((await db('get_draft')).text, 'one');
  await click('library', '.new-idea-button');
  await input('capture', '[aria-label="Your idea"]', '');
  assert.equal(await pasteCapture('https://example.com/automatic'), false);
  await until(async () => (await db('get_draft')).links.length === 1, 'automatic link saved');
  assert.equal(await evaluate('capture', () => document.querySelector('textarea').value), '');
  assert.equal(await pasteCapture('https://example.com/automatic'), true);
  await until(
    async () => (await db('get_draft')).text === 'https://example.com/automatic',
    'repeat paste stays in text',
  );
  assert.equal((await db('get_draft')).links.length, 1);
  await click('capture', '.link-slot');
  await evaluate('capture', () =>
    Array.from(document.querySelectorAll('.popover-actions button'))
      .find((e) => e.textContent.includes('Remove'))
      .click(),
  );
  await until(async () => !(await db('get_draft')).links.length, 'automatic link removable');
  await input('capture', '[aria-label="Your idea"]', '');
  assert.equal(await pasteCapture('Keep https://example.com inside this sentence'), true);
  assert.equal((await db('get_draft')).links.length, 0);
  console.log(
    'PASS: rotating prompts, repeat-safe double shortcut, automatic links, repeat-paste text, and mixed prose.',
  );
  const poem =
    'A poem about the things we almost notice\n  sunlight on the kitchen floor 🌱\n\nand the kettle, again';
  await input('capture', '[aria-label="Your idea"]', poem);
  await until(async () => (await db('get_draft')).text === poem, 'draft text autosaved');
  await pasteLink('not a link');
  await until(() => text('capture', '.field-error'), 'invalid link feedback');
  assert.ok(
    await evaluate('capture', () => {
      const error = document.querySelector('.field-error').getBoundingClientRect();
      return error.bottom <= innerHeight;
    }),
  );
  assert.equal(await evaluate('capture', () => document.activeElement?.id), 'paste-link');
  assert.equal((await db('get_draft')).text, poem);
  await key('capture', 'Escape');
  await pasteLink('https://example.com/poetry?draft=1#verse');
  await until(async () => (await db('get_draft')).links.length === 1, 'reference saved to draft');
  await until(
    () => evaluate('capture', () => !!document.querySelector('.link-slot.filled:not(.pending)')),
    'filled link confirmation',
  );
  assert.equal(
    await evaluate('capture', () => document.querySelector('[aria-label="Your idea"]').value),
    poem,
  );
  await screenshot('capture', 'capture-expanded.png');
  await click('capture', '[aria-label="Open idea library"]');
  await until(() => text('library', '.library-welcome'), 'book opens library');
  assert.equal((await db('list_ideas', {})).total, 0);
  await click('library', '.new-idea-button');
  assert.equal(
    await evaluate('capture', () => document.querySelector('[aria-label="Your idea"]').value),
    poem,
  );
  const captureSaveStarted = Date.now();
  await click('capture', '[aria-label="Save idea · ⌘Enter"]');
  await until(
    () =>
      evaluate('capture', () => {
        return (
          document.querySelector('.capture-shell').dataset.stage === 'tucking' &&
          !!document.querySelector('.tuck-pocket')
        );
      }),
    'paper starts folding after the commit',
  );
  assert.equal((await db('list_ideas', {})).total, 1, 'the tuck starts only after commit');
  await screenshot('capture', 'capture-saving.png');
  const tuckFrames = await evaluate('capture', async () => {
    const frames = [];
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      if (document.querySelector('.confirmation-check')) return frames;
      const paper = document.querySelector('.capture-card').getBoundingClientRect();
      const pocket = document.querySelector('.tuck-pocket').getBoundingClientRect();
      frames.push({
        at: Date.now(),
        paperY: paper.y,
        pocketHeight: pocket.height,
        paperWidth: paper.width,
        pocketBottom: pocket.bottom,
        windowHeight: innerHeight,
      });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    throw new Error('Tuck never reached the checkmark');
  });
  assert.ok(Date.now() - captureSaveStarted >= 1900, 'fold and tuck have time to read');
  assert.ok(
    tuckFrames.at(-1).at - tuckFrames[0].at >= 1000,
    'the tuck remains visible for at least a second',
  );
  assert.ok(
    Math.max(...tuckFrames.map((f) => f.paperY)) - Math.min(...tuckFrames.map((f) => f.paperY)) >
      10,
    'the paper visibly lifts and drops',
  );
  assert.ok(
    Math.max(...tuckFrames.map((f) => f.pocketHeight)) -
      Math.min(...tuckFrames.map((f) => f.pocketHeight)) >
      1,
    'the pocket softly squashes and settles',
  );
  assert.ok(
    Math.max(...tuckFrames.map((f) => f.paperWidth)) > 400 &&
      Math.min(...tuckFrames.map((f) => f.paperWidth)) < 90,
    'the entire paper folds down to a small slip',
  );
  assert.ok(
    tuckFrames.every((frame) => frame.pocketBottom + 10 < frame.windowHeight),
    'the pocket and its shadow fit inside the native window',
  );
  await writeFile(resolve(artifacts, 'capture-tuck.json'), JSON.stringify(tuckFrames, null, 2));
  assert.equal((await db('list_ideas', {})).total, 1);
  await until(
    () =>
      evaluate('capture', () => {
        const check = document.querySelector('.confirmation-check path');
        return check && parseFloat(getComputedStyle(check).strokeDashoffset) < 0.1;
      }),
    'checkmark finishes drawing',
  );
  const checkDrawnAt = Date.now();
  await screenshot('capture', 'capture-saved.png');
  const completionFrames = await evaluate('library', async () => {
    const frames = [];
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const surface = await window.__TAURI_INTERNALS__.invoke('capture_surface');
      frames.push({ at: Date.now(), ...surface });
      if (!surface.visible && surface.height <= 110) return frames;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    throw new Error(`Capture never finished resetting: ${JSON.stringify(frames.slice(-3))}`);
  });
  const fading = completionFrames.filter((frame) => frame.visible && frame.alpha < 0.99);
  assert.ok(fading.length >= 3, 'the native window fades through intermediate opacities');
  assert.ok(fading[0].at - checkDrawnAt >= 800, 'the fully drawn check holds for about a second');
  assert.ok(fading.at(-1).at - fading[0].at >= 150, 'fade is gradual rather than a sudden hide');
  assert.ok(
    completionFrames
      .filter((frame) => frame.visible)
      .every((frame) => frame.height > 110 && frame.glassWidth === 0),
    'the native surface never resets or gains glass while the pocket is visible',
  );
  assert.ok(
    completionFrames.filter((frame) => !frame.visible).every((frame) => frame.alpha === 0),
    'the reset stays fully transparent after hiding',
  );
  await writeFile(
    resolve(artifacts, 'capture-completion.json'),
    JSON.stringify(completionFrames, null, 2),
  );
  await until(async () => (await db('list_ideas', {})).total === 1, 'capture committed');
  await until(async () => (await db('get_draft')).text === '', 'fresh draft ready');
  await click('library', '.new-idea-button');
  await until(() => evaluate('capture', () => document.hasFocus()), 'capture opens after fade');
  assert.equal((await invoke('library', 'capture_surface')).alpha, 1);
  assert.equal(await evaluate('capture', () => document.querySelector('textarea').value), '');
  assert.ok(
    await evaluate(
      'capture',
      () => document.querySelector('.capture-card').getBoundingClientRect().width > 600,
    ),
  );
  await key('capture', 'Escape');
  console.log(
    'PASS: unhurried tuck after commit, full checkmark hold, native fade, invisible reset, and clean next invocation.',
  );
  console.log(
    'PASS: invalid paste, draft persistence, link attachment, book handoff, and capture commit.',
  );
  const id = (await db('list_ideas', {})).ideas[0].id;
  await invoke('library', 'window_action', { action: 'library', height: null });
  await until(
    () => evaluate('library', () => !!document.querySelector('.idea-row')),
    'saved idea listed',
  );
  assert.equal((await text('library', '.idea-row-title')).trim(), 'Untitled');
  assert.ok(
    await evaluate(
      'library',
      () => document.querySelector('.idea-row').getBoundingClientRect().height <= 65,
    ),
  );
  await click('library', '.idea-row');
  await until(
    () => evaluate('library', () => !!document.querySelector('.writing-surface')),
    'formatted editor',
  );
  await input('library', '[aria-label="Idea title"]', 'The almost-noticed things');
  await click('library', '[aria-label="Bold · ⌘B"]');
  await evaluate('library', () => {
    const editor = document.querySelector('.writing-surface');
    editor.focus();
    document.execCommand('insertText', false, 'The shape of an ordinary morning');
  });
  await until(
    async () => JSON.stringify((await db('get_idea', { id })).body).includes('ordinary morning'),
    'rich text autosave',
  );
  let idea = await db('get_idea', { id });
  assert.equal(idea.title, 'The almost-noticed things');
  assert.ok(JSON.stringify(idea.body).includes('"bold"'));
  assert.equal(idea.captureText, poem);
  await click('library', '[aria-label="Add type"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('.tag-option')),
    'type picker',
  );
  await evaluate('library', () =>
    Array.from(document.querySelectorAll('.tag-option>button:first-child'))
      .find((e) => e.textContent.includes('Poem'))
      .click(),
  );
  await until(
    async () => (await db('get_idea', { id })).tags.some((t) => t.name === 'Poem'),
    'type assigned',
  );
  await click('library', '[aria-label="Star idea"]');
  await until(async () => !!(await db('get_idea', { id })).starredAt, 'star saved');
  await screenshot('library', 'library-writing.png');
  await click('library', '[aria-label="Add type"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('.tag-option')),
    'second type picker',
  );
  await evaluate('library', () =>
    Array.from(document.querySelectorAll('.tag-option>button:first-child'))
      .find((e) => e.textContent.includes('Video'))
      .click(),
  );
  await until(
    async () => (await db('get_idea', { id })).tags.filter((t) => t.axis === 'type').length === 2,
    'multiple types',
  );
  const typed = await db('get_idea', { id });
  const poemTag = typed.tags.find((t) => t.name === 'Poem');
  await db('rename_tag', { id: poemTag.id, name: 'Poetry' });
  assert.equal(
    (await db('get_idea', { id })).tags.find((t) => t.id === poemTag.id).color,
    poemTag.color,
  );
  await click('library', '.archive-button');
  await until(async () => !!(await db('get_idea', { id })).archivedAt, 'archive saved');
  await click('library', '.archive-button');
  await until(async () => !(await db('get_idea', { id })).archivedAt, 'restore saved');
  idea = await db('get_idea', { id });
  assert.ok(idea.starredAt);
  assert.equal(idea.links.length, 1);
  await click('library', '[aria-label="Back to library"]');
  await input('library', '[aria-label="Search ideas"]', 'ordinary morning');
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.list-caption').textContent.includes('1 match'),
      ),
    'body search',
  );
  await input('library', '[aria-label="Search ideas"]', 'no-thought-should-match-4839');
  await until(
    () => evaluate('library', () => !document.querySelector('.idea-row')),
    'empty search',
  );
  await input('library', '[aria-label="Search ideas"]', '');
  console.log('PASS: live formatting, autosave, title, type, star, archive/restore, and search.');
  await click('library', '[aria-label="Settings"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('[aria-label="Record shortcut"]')),
    'shortcut recorder available',
  );
  const originalSettings = await db('get_settings');
  await invoke('library', 'window_action', { action: 'library', height: null });
  await until(
    () => evaluate('library', () => document.hasFocus()),
    'library focused for shortcut recording',
  );
  await click('library', '[aria-label="Record shortcut"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('.shortcut-recorder.recording')),
    'recording started',
  );
  await key('library', 'Meta', { code: 'MetaLeft', metaKey: true });
  assert.equal(await text('library', '.shortcut-keys kbd'), '⌘');
  await key('library', 'k', { code: 'KeyK', metaKey: true, ctrlKey: true, altKey: true });
  assert.ok(
    await evaluate('library', () => !!document.querySelector('.shortcut-recorder.recording')),
  );
  await evaluate('library', () =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft', bubbles: true }),
    ),
  );
  await until(
    () => evaluate('library', () => !document.querySelector('.shortcut-recorder.recording')),
    'chord recorded',
  );
  assert.equal(
    await evaluate('library', () =>
      Array.from(document.querySelectorAll('.shortcut-keys kbd'))
        .map((el) => el.textContent)
        .join(''),
    ),
    '⌃⌥⌘K',
  );
  await click('library', '.settings-modal footer .primary-button');
  await until(
    async () => (await db('get_settings')).shortcut === 'Control+Alt+Command+KeyK',
    'recorded shortcut registered and persisted',
  );
  await screenshot('library', 'settings-shortcut.png');
  await invoke('library', 'window_action', { action: 'library', height: null });
  await until(
    () => evaluate('library', () => document.hasFocus()),
    'library focused for shortcut recording',
  );
  await click('library', '[aria-label="Record shortcut"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('.shortcut-recorder.recording')),
    'recorder reopened',
  );
  await key('library', 'Escape', { code: 'Escape' });
  await until(
    () => evaluate('library', () => !document.querySelector('.shortcut-recorder.recording')),
    'escape cancels recording',
  );
  assert.equal((await db('get_settings')).shortcut, 'Control+Alt+Command+KeyK');
  await click('library', '[aria-label="Close settings"]');
  await invoke('library', 'update_settings', { settings: originalSettings });
  console.log('PASS: live shortcut keycaps, registration, persistence, and cancellation.');
  await click('library', '.new-idea-button');
  await input('capture', '[aria-label="Your idea"]', 'An unfinished weekend project');
  await key('capture', 'Escape');
  await until(
    async () => (await db('get_draft')).text === 'An unfinished weekend project',
    'dismiss persists draft',
  );
  await click('library', '.new-idea-button');
  sql(
    "CREATE TRIGGER fail_capture BEFORE INSERT ON ideas BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
  );
  await click('capture', '[aria-label="Save idea · ⌘Enter"]');
  await until(() => text('capture', '.capture-error'), 'failed write retains the capture');
  assert.equal(
    await evaluate('capture', () => document.querySelector('[aria-label="Your idea"]').value),
    'An unfinished weekend project',
  );
  assert.equal(await evaluate('capture', () => !!document.querySelector('.is-saved')), false);
  assert.equal((await db('list_ideas', {})).total, 1);
  sql('DROP TRIGGER fail_capture;');
  await key('capture', 'Escape');
  console.log('PASS: failed database commit preserves text and omits the saved animation.');
  const exportBefore = await db('export_data');
  assert.equal(exportBefore.ideas.length, 1);
  assert.equal(exportBefore.draft.text, 'An unfinished weekend project');
  await stop();
  await start();
  const restored = await db('get_idea', { id });
  assert.deepEqual(restored.body, idea.body);
  assert.equal(restored.captureText, poem);
  assert.ok(restored.starredAt);
  assert.ok(restored.tags.some((t) => t.name === 'Poetry'));
  assert.equal((await db('get_draft')).text, 'An unfinished weekend project');
  assert.equal((await db('list_ideas', {})).total, 1);
  console.log(
    'PASS: graceful quit/relaunch preserves body, original capture, references, tags, state, and unfinished draft.',
  );
  await stop(true);
  await start();
  assert.equal((await db('list_ideas', {})).total, 1);
  assert.equal((await db('get_draft')).text, 'An unfinished weekend project');
  console.log(
    'PASS: force termination after save preserves committed data and the persisted draft.',
  );
  const doorwayTimes = [];
  const saveTimes = [];
  for (let index = 0; index < 50; index++) {
    const started = performance.now();
    await invoke('library', 'window_action', { action: 'capture', height: null });
    await until(
      () =>
        evaluate(
          'capture',
          () =>
            document.hasFocus() &&
            document.activeElement?.getAttribute('aria-label') === 'Your idea',
        ),
      `warm capture focus ${index + 1}/50`,
    );
    doorwayTimes.push(performance.now() - started);
    const draft = await db('get_draft');
    const savedAt = performance.now();
    await db('save_draft', {
      ...draft,
      sequence: draft.sequence + 1,
      text: `Timing check ${index}`,
    });
    saveTimes.push(performance.now() - savedAt);
    // Restore the UI-owned draft before its close handler flushes, keeping its sequence coherent.
    await input('capture', '[aria-label="Your idea"]', `Timing check ${index}`);
    await input('capture', '[aria-label="Your idea"]', `Timing check ${index} done`);
    await key('capture', 'Escape');
    await until(() => evaluate('capture', () => !document.hasFocus()), 'capture dismissed');
  }
  const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const timings = {
    warmCaptureP95Ms: p95(doorwayTimes),
    draftWriteP95Ms: p95(saveTimes),
    samples: 50,
    method: 'Native debug app; timings include localhost test-driver round trips.',
  };
  console.log(`TIMING: ${JSON.stringify(timings)}`);
  // A new doorway request can skip decoration without letting the old
  // completion hide the new capture.
  for (const interruption of ['tuck', 'hold', 'fade', 'library']) {
    await click('library', '.new-idea-button');
    await input('capture', '[aria-label="Your idea"]', `Animation interruption: ${interruption}`);
    await click('capture', '[aria-label="Save idea · ⌘Enter"]');
    await until(
      () =>
        evaluate(
          'capture',
          (selector) => !!document.querySelector(selector),
          interruption === 'tuck' ? '.tucking .tuck-pocket' : '.confirmation-check',
        ),
      `${interruption}: requested animation stage`,
    );
    const requestedAt = await evaluate(
      'library',
      async (interruption) => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        if (interruption === 'fade' || interruption === 'library') {
          const end = Date.now() + 3000;
          while (true) {
            const { visible, alpha } = await invoke('capture_surface');
            if (visible && alpha > 0.1 && alpha < 0.9) break;
            if (Date.now() >= end) throw new Error('Did not reach the native fade');
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        }
        const at = Date.now();
        const action = (action) => invoke('window_action', { action, height: null });
        if (interruption === 'library') {
          await action('test-shortcut-down');
          await action('test-shortcut-up');
          await action('test-shortcut-down');
          await action('test-shortcut-up');
        } else await action('capture');
        return at;
      },
      interruption,
    );
    if (interruption === 'library') {
      await until(
        async () => !(await invoke('library', 'capture_surface')).visible,
        'library handoff hides capture',
      );
      await until(
        () => evaluate('library', () => document.hasFocus()),
        'double shortcut reaches library during fade',
      );
      await pause(400);
      assert.equal((await invoke('library', 'capture_surface')).visible, false);
    } else {
      await until(
        () =>
          evaluate(
            'capture',
            () =>
              document.hasFocus() &&
              document.querySelector('.capture-shell').dataset.stage === 'editing' &&
              document.querySelector('textarea').value === '',
          ),
        `${interruption}: fresh capture is ready`,
      );
      assert.equal((await invoke('library', 'capture_surface')).alpha, 1);
      if (interruption === 'tuck' || interruption === 'hold')
        assert.ok(Date.now() - requestedAt < 950, 'new capture skips the remaining tuck or hold');
      await pause(400);
      assert.equal(
        (await invoke('library', 'capture_surface')).visible,
        true,
        'old completion cannot dismiss new capture',
      );
      await key('capture', 'Escape');
    }
  }
  console.log('PASS: capture during the tuck/check hold/fade and double-shortcut library handoff.');
  await writeFile(
    resolve(artifacts, 'desktop-result.json'),
    JSON.stringify(
      { passed: true, dataPath: data, ideaId: id, checkedAt: new Date().toISOString(), timings },
      null,
      2,
    ),
  );
  await stop();
} catch (error) {
  console.error(error.stack);
  try {
    console.error(
      'Capture state:',
      JSON.stringify(
        await evaluate('capture', () => ({
          focused: document.hasFocus(),
          active: document.activeElement?.outerHTML,
          error: document.querySelector('.capture-error')?.textContent,
          viewport: [innerWidth, innerHeight],
          text: document.querySelector('textarea')?.value,
        })),
      ),
    );
  } catch {}
  console.error(logs.slice(-6000));
  await writeFile(resolve(artifacts, 'desktop-failure.log'), `${error.stack}\n${logs}`);
  try {
    await screenshot('library', 'failure.png');
  } catch {}
  if (app?.exitCode === null) app.kill('SIGKILL');
  process.exitCode = 1;
}
