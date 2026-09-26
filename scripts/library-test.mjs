import assert from 'node:assert/strict';
import { checkEditorLayout } from './library-layout-test.mjs';

export async function checkLibrary({
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
}) {
  // Exercise the light palette explicitly; the Mac may be in Dark Mode.
  await evaluate('library', () => {
    for (const sheet of document.styleSheets)
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === '.library-shell' && rule.style.getPropertyValue('--linen')) {
          for (const property of rule.style)
            if (property.startsWith('--') || property === 'color-scheme')
              document
                .querySelector('.library-shell')
                .style.setProperty(property, rule.style.getPropertyValue(property));
        }
      }
  });
  await click('library', '[aria-label="List view"]');
  const samples = [
    [
      'The quiet between things',
      'Poem',
      'The pause before the kettle clicks. A poem about all the little spaces a day leaves open.',
    ],
    [
      'A tiny neighbourhood radio',
      'Project',
      'A weekend radio station where anyone on the block can leave a song, a story, or a hello.',
    ],
    [
      'On keeping unfinished things',
      'Essay',
      'Maybe an unfinished notebook is a record of curiosity rather than a failure of discipline.',
    ],
    [
      'A film about the last bus',
      'Video',
      'Follow the last bus home. Warm windows, empty seats, and the driver who knows every stop.',
    ],
    [null, null, 'A shelf of books arranged by the weather you would read them in.'],
    [
      'Sunday plum cake',
      'Recipe',
      'Plums, brown butter, and something a little sharp. Try the recipe from the market stall.',
    ],
    [
      'The colour of a familiar voice',
      'Exploration',
      'What would a colour palette made from the voices of people I love look like?',
    ],
    [
      'A small map of good benches',
      'Project',
      'Somewhere to sit with a coffee. A map that starts with three favourite spots.',
    ],
    [
      'Things my grandmother folded',
      'Poem',
      'Tea towels, letters, corners of pages. How a crease can hold a memory.',
    ],
    ['Make room for wandering', 'Essay', ''],
    [
      'A walk without a destination',
      'Video',
      'Record a morning walk without deciding where to go. Notice what pulls me along.',
    ],
    [
      'Kitchen window garden',
      'Project',
      'A tiny herb garden in old mugs. Mint, basil, and a little room for mistakes.',
    ],
  ];
  await db('create_tag', { axis: 'type', name: 'Recipe' });
  const topic = await db('create_tag', { axis: 'topic', name: 'Everyday life' });
  const tags = await db('list_tags'),
    ids = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let n = 0; n < 60; n++) {
    const [title, type, body] = samples[n % samples.length];
    const draft = await db('get_draft');
    draft.text = body || title;
    draft.sequence++;
    let idea = await db('commit_capture', draft);
    idea = await db('update_content', {
      ...idea,
      title: title ? `${title}${n >= 12 ? ` · ${Math.floor(n / 12) + 1}` : ''}` : null,
    });
    ids.push(idea.id);
    if (type)
      await db('set_tag', {
        id: idea.id,
        tagId: tags.find((t) => t.name === type).id,
        enabled: true,
      });
    if (n % 2 === 0) await db('set_tag', { id: idea.id, tagId: topic.id, enabled: true });
    if (n % 4 === 0) await db('set_starred', { id: idea.id, enabled: true });
    if (n % 3 === 0)
      await db('add_link', {
        id: idea.id,
        link: {
          id: crypto.randomUUID(),
          url: `https://example.com/idea/${n}`,
          key: `https://example.com/idea/${n}`,
          hostname: 'example.com',
        },
      });
    if (n % 10 === 9) await db('set_archived', { id: idea.id, enabled: true });
    const date = new Date(today);
    date.setDate(date.getDate() - Math.floor(n / 3));
    date.setMinutes(60 - n);
    sql(`UPDATE ideas SET created_at=${date.getTime()} WHERE id='${idea.id}';`);
  }
  await invoke('library', 'window_action', { action: 'library', height: null });
  await evaluate('library', () => window.dispatchEvent(new Event('focus')));
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.list-caption').textContent.includes('54 ideas'),
      ),
    '54 active ideas',
  );
  assert.equal(await evaluate('library', () => document.querySelectorAll('.idea-row').length), 12);
  assert.equal(
    await evaluate(
      'library',
      () =>
        !!document.querySelector('.idea-row .lucide-link, .idea-row .link-count, .type-labels svg'),
    ),
    false,
  );
  await screenshot('library', 'linen-list.png');
  await click('library', '.browse-star');
  await until(async () => !(await db('get_idea', { id: ids[0] })).starredAt, 'list star persists');
  await until(
    () => evaluate('library', () => !document.querySelector('.browse-star').disabled),
    'star mutation finished',
  );
  await click('library', '.browse-star');
  await until(async () => !!(await db('get_idea', { id: ids[0] })).starredAt, 'list star restores');

  await click('library', '[aria-label="Grid view"]');
  await until(
    () => evaluate('library', () => document.querySelectorAll('.idea-card').length === 12),
    'grid layout',
  );
  await screenshot('library', 'linen-grid.png');
  await click('library', '[aria-label="Next page"]');
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.browse-pagination').textContent.includes('13–24'),
      ),
    'second page',
  );
  const before = await evaluate('library', () =>
    [...document.querySelectorAll('.idea-row-title')].map((e) => e.textContent),
  );
  await click('library', '.idea-row');
  await until(
    () => evaluate('library', () => !!document.querySelector('.writing-surface')),
    'open a card',
  );
  await until(
    () => evaluate('library', () => document.querySelectorAll('.editor-idea-row').length === 54),
    'sidebar includes active ideas beyond the browse page',
  );
  assert.ok(
    await evaluate('library', () =>
      [...document.querySelectorAll('.editor-idea-row')].every(
        (row) => row.getBoundingClientRect().height <= 40,
      ),
    ),
  );
  const selectedId = await evaluate(
    'library',
    () => document.querySelector('.editor-idea-row[aria-current="page"]').dataset.sidebarId,
  );
  const nextId = await evaluate(
    'library',
    () => document.querySelector('.editor-idea-row:not([aria-current])').dataset.sidebarId,
  );
  const markerCounts = await evaluate(
    'library',
    (ids) =>
      ids.map(
        (id) =>
          document.querySelector(`[data-sidebar-id="${id}"]`).querySelectorAll('.sidebar-type-bar')
            .length,
      ),
    [ids[0], ids[1], ids[4], ids[5]],
  );
  assert.deepEqual(
    markerCounts,
    [1, 1, 0, 1],
    'type markers include custom types and omit topic-only ideas',
  );
  await click('library', '[aria-label="Add type"]');
  await evaluate('library', () =>
    [...document.querySelectorAll('.tag-option > button:first-child')]
      .find((button) => button.textContent.trim() === 'Poem')
      .click(),
  );
  await until(
    () =>
      evaluate(
        'library',
        () =>
          document.querySelectorAll('.editor-idea-row[aria-current] .sidebar-type-bar').length ===
          2,
      ),
    'sidebar reflects a second type immediately',
  );
  assert.ok(
    await evaluate('library', () => {
      const bars = [
        ...document.querySelectorAll('.editor-idea-row[aria-current] .sidebar-type-bar'),
      ];
      return (
        bars.every((bar) => getComputedStyle(bar).backgroundColor !== 'rgba(0, 0, 0, 0)') &&
        getComputedStyle(bars[0]).backgroundColor !== getComputedStyle(bars[1]).backgroundColor
      );
    }),
    'each assigned type uses its own visible color',
  );
  await click('library', '[aria-label="Remove Poem tag"]');
  await until(
    () =>
      evaluate(
        'library',
        () =>
          document.querySelectorAll('.editor-idea-row[aria-current] .sidebar-type-bar').length ===
          1,
      ),
    'sidebar reflects type removal',
  );
  await input('library', '[aria-label="Idea title"]', 'A revised idea from the second page');
  assert.equal(
    await evaluate(
      'library',
      () =>
        document.querySelector('.editor-idea-row[aria-current="page"] .editor-idea-title')
          .textContent,
    ),
    'A revised idea from the second page',
  );
  await click('library', `[data-sidebar-id="${nextId}"]`);
  await until(
    () =>
      evaluate(
        'library',
        (id) =>
          document.querySelector('.editor-idea-row[aria-current="page"]').dataset.sidebarId === id,
        nextId,
      ),
    'switch to another sidebar idea',
  );
  assert.equal(
    (await db('get_idea', { id: selectedId })).title,
    'A revised idea from the second page',
  );
  await click('library', `[data-sidebar-id="${selectedId}"]`);
  await until(
    () =>
      evaluate(
        'library',
        () => document.querySelector('.idea-title').value === 'A revised idea from the second page',
      ),
    'return to saved writing',
  );
  sql(
    `CREATE TRIGGER reject_sidebar_edit BEFORE UPDATE OF title ON ideas WHEN old.id='${selectedId}' BEGIN SELECT RAISE(ABORT,'injected sidebar write failure'); END;`,
  );
  await input('library', '[aria-label="Idea title"]', 'Keep this unsaved writing');
  await click('library', `[data-sidebar-id="${nextId}"]`);
  await until(
    () => evaluate('library', () => !!document.querySelector('.save-state.error')),
    'failed save blocks sidebar navigation',
  );
  assert.equal(
    await evaluate(
      'library',
      () => document.querySelector('.editor-idea-row[aria-current="page"]').dataset.sidebarId,
    ),
    selectedId,
  );
  assert.equal(
    await evaluate('library', () => document.querySelector('.idea-title').value),
    'Keep this unsaved writing',
  );
  sql('DROP TRIGGER reject_sidebar_edit;');
  await click('library', `[data-sidebar-id="${nextId}"]`);
  await until(
    () =>
      evaluate(
        'library',
        (id) =>
          document.querySelector('.editor-idea-row[aria-current="page"]').dataset.sidebarId === id,
        nextId,
      ),
    'sidebar navigation retries the retained edit',
  );
  assert.equal((await db('get_idea', { id: selectedId })).title, 'Keep this unsaved writing');
  await click('library', `[data-sidebar-id="${selectedId}"]`);
  await until(
    () =>
      evaluate(
        'library',
        () => document.querySelector('.idea-title').value === 'Keep this unsaved writing',
      ),
    'reopen retained edit',
  );
  await input('library', '[aria-label="Idea title"]', 'A revised idea from the second page');
  await key('library', 'f', { metaKey: true });
  assert.equal(
    await evaluate('library', () => document.activeElement.getAttribute('aria-label')),
    'Search sidebar ideas',
  );
  await input('library', '[aria-label="Search sidebar ideas"]', 'Sunday plum cake');
  await until(
    () =>
      evaluate(
        'library',
        () =>
          document.querySelectorAll('.editor-idea-row').length === 5 &&
          !!document.querySelector('.editor-current-note'),
      ),
    'sidebar search keeps the open note available',
  );
  assert.equal(
    await evaluate('library', () => document.querySelector('.idea-title').value),
    'A revised idea from the second page',
  );
  await click('library', '[aria-label="Clear sidebar search"]');
  await until(
    () => evaluate('library', () => document.querySelectorAll('.editor-idea-row').length === 54),
    'sidebar search cleared',
  );
  await screenshot('library', 'linen-editor-sidebar.png');
  await checkEditorLayout({ evaluate, input, click, until, screenshot, resize });
  await click('library', '[aria-label="Back to library"]');
  await until(
    () => evaluate('library', () => !document.querySelector('.browse-pane').hidden),
    'back after flush',
  );
  assert.ok(
    await evaluate('library', () =>
      document.querySelector('.browse-pagination').textContent.includes('13–24'),
    ),
  );
  assert.equal(await evaluate('library', () => document.querySelectorAll('.idea-card').length), 12);
  assert.equal(
    await evaluate('library', () => document.querySelector('.idea-row-title').textContent),
    'A revised idea from the second page',
  );
  assert.equal(
    (
      await evaluate('library', () =>
        [...document.querySelectorAll('.idea-row-title')].map((e) => e.textContent),
      )
    )[1],
    before[1],
  );
  await click('library', '[aria-label="Filter ideas"]');
  await evaluate('library', () =>
    [...document.querySelectorAll('.filter-choice')]
      .find((e) => e.textContent === 'Recipe')
      .querySelector('input')
      .click(),
  );
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.list-caption').textContent.includes('4 matches'),
      ),
    'custom type filter',
  );
  assert.equal(
    await evaluate('library', () => document.querySelector('.filter-choice').querySelector('svg')),
    null,
  );
  await screenshot('library', 'linen-filters.png');
  await click('library', '[aria-label="Close filters"]');
  await click('library', '.idea-row');
  await until(
    () => evaluate('library', () => document.querySelectorAll('.editor-idea-row').length === 4),
    'sidebar inherits browse type filter',
  );
  await click('library', '.editor-sidebar-caption button');
  await until(
    () => evaluate('library', () => document.querySelectorAll('.editor-idea-row').length === 54),
    'sidebar can expand to all ideas',
  );
  await click('library', '[aria-label="Back to library"]');
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.list-caption').textContent.includes('4 matches'),
      ),
    'browser retains its original type filter',
  );
  await click('library', '[aria-label="Filter ideas"]');

  await evaluate('library', () =>
    [...document.querySelectorAll('.filter-choice')]
      .find((e) => e.textContent === 'No type')
      .querySelector('input')
      .click(),
  );
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.list-caption').textContent.includes('9 matches'),
      ),
    'No type OR custom type',
  );
  await evaluate('library', () =>
    [...document.querySelectorAll('.filter-choice')]
      .find((e) => e.textContent === 'Has links')
      .querySelector('input')
      .click(),
  );
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.library-welcome')?.textContent.includes('No matches'),
      ),
    'composed links filter',
  );
  await evaluate('library', () =>
    [...document.querySelectorAll('.filter-panel-footer button')]
      .find((e) => e.textContent === 'Reset')
      .click(),
  );
  await evaluate('library', () => {
    const select = document.querySelector('[aria-label="Captured date"]');
    select.value = 'today';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.list-caption').textContent.includes('3 matches'),
      ),
    'today uses local creation date',
  );
  await evaluate('library', () =>
    [...document.querySelectorAll('.filter-panel-footer button')]
      .find((e) => e.textContent === 'Reset')
      .click(),
  );
  await click('library', '[aria-label="Close filters"]');
  await input('library', '[aria-label="Search ideas"]', 'no matching note 123');
  await until(
    () =>
      evaluate('library', () =>
        document.querySelector('.library-welcome')?.textContent.includes('No matches'),
      ),
    'empty filtered browse',
  );
  await click('library', '[aria-label="Pull an idea"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('.pocket-open-idea')),
    'pocket ignores active filters',
  );
  const first = await evaluate(
    'library',
    () => document.querySelector('.pocket-open-idea').textContent,
  );
  await click('library', '.pocket-another');
  await until(
    () =>
      evaluate(
        'library',
        (first) =>
          !!document.querySelector('.pocket-open-idea') &&
          document.querySelector('.pocket-open-idea').textContent !== first,
        first,
      ),
    'another idea',
  );
  await screenshot('library', 'linen-pocket.png');
  await click('library', '.pocket-open-idea');
  await until(
    () => evaluate('library', () => !!document.querySelector('.writing-surface')),
    'pocket opens editor',
  );
  await screenshot('library', 'linen-writing.png');
  await click('library', '[aria-label="Back to library"]');
  assert.equal(
    await evaluate('library', () => document.querySelector('[aria-label="Search ideas"]').value),
    'no matching note 123',
  );
  await input('library', '[aria-label="Search ideas"]', '');
  await click('library', '[aria-label="Settings"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('.settings-modal')),
    'settings',
  );
  await evaluate('library', () =>
    [...document.querySelectorAll('.toggle-row')]
      .find((e) => e.textContent.includes('Ideas in the pocket'))
      .querySelector('input')
      .click(),
  );
  await click('library', '.settings-modal .primary-button');
  await until(async () => !(await db('get_settings')).pocketIdeas, 'pocket preference saved');
  await click('library', '[aria-label="Close settings"]');
  await until(
    () => evaluate('library', () => !!document.querySelector('[aria-label="Peek inside"]')),
    'keepsake mode',
  );
  // Keyboard focus uses the same invitation/wiggle as hover, without revealing the paper.
  await evaluate('library', () => document.querySelector('.pocket').focus());
  await pause(700);
  assert.equal(
    await evaluate(
      'library',
      () => getComputedStyle(document.querySelector('.pocket-slip')).opacity,
    ),
    '0',
  );
  await click('library', '[aria-label="Peek inside"]');
  await pause(900);
  assert.equal(
    await evaluate(
      'library',
      () => getComputedStyle(document.querySelector('.pocket-slip')).opacity,
    ),
    '1',
  );
  assert.equal(await evaluate('library', () => !!document.querySelector('.pocket-preview')), false);
  await screenshot('library', 'linen-keepsake.png');
  await until(
    () =>
      evaluate(
        'library',
        () => getComputedStyle(document.querySelector('.pocket-slip')).opacity === '0',
      ),
    'keepsake tucks away',
    5000,
  );
  await click('library', '[aria-label="List view"]');
  // Preview the actual dark palette without changing the user's macOS appearance.
  await evaluate('library', () => {
    for (const sheet of document.styleSheets)
      for (const rule of sheet.cssRules) {
        if (
          rule instanceof CSSMediaRule &&
          rule.conditionText.includes('prefers-color-scheme: dark')
        ) {
          for (const style of rule.cssRules)
            if (style.selectorText === '.library-shell')
              for (const property of style.style)
                if (property.startsWith('--') || property === 'color-scheme')
                  document
                    .querySelector('.library-shell')
                    .style.setProperty(property, style.style.getPropertyValue(property));
        }
      }
  });
  await screenshot('library', 'linen-dark.png');
  await resize('library', 800, 560);
  await until(() => evaluate('library', () => innerWidth === 800), 'compact dark browser');
  assert.ok(
    await evaluate(
      'library',
      () => document.querySelector('.browse-pane').scrollWidth <= innerWidth,
    ),
  );
  await screenshot('library', 'linen-browse-compact-dark.png');
  await click('library', '.idea-row');
  await until(
    () => evaluate('library', () => !!document.querySelector('.idea-title')),
    'dark editor',
  );
  await evaluate('library', () => document.activeElement.blur());
  await screenshot('library', 'linen-editor-compact-dark.png');
  await evaluate('library', () =>
    document.querySelector('.library-shell').removeAttribute('style'),
  );
  console.log(
    'PASS: 60 ideas; list/grid pagination; custom types and composed filters; saved edits with browse context preserved; compact editor sidebar, independent search, and failed-save navigation protection; whole-library pocket, another/open, persisted keepsake setting, concealed slip until click, and light/dark palettes.',
  );
}
