import assert from 'node:assert/strict';

// Exercise real WKWebView reflow, including the native minimum window size.
export async function checkEditorLayout({ evaluate, input, click, until, screenshot, resize }) {
  const title = await evaluate('library', () => document.querySelector('.idea-title').value);
  await input(
    'library',
    '.idea-title',
    'A small collection of things I want to remember on the way home',
  );
  await evaluate('library', () => document.activeElement.blur());
  for (const [name, width, height] of [
    ['large', 1600, 1000],
    ['compact', 800, 560],
    ['regular', 1120, 780],
  ]) {
    await resize('library', width, height);
    await until(
      () => evaluate('library', (width) => innerWidth === width, width),
      `${name} viewport`,
    );
    await evaluate(
      'library',
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const layout = await evaluate('library', () => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const title = document.querySelector('.idea-title');
      const toolbar = document.querySelector('.editor-toolbar');
      document.querySelector('.detail-scroll').scrollTop = 0;
      document.querySelector('.editor-sidebar-list').scrollTop = 0;
      return {
        width: innerWidth,
        height: innerHeight,
        chrome: rect('.library-chrome'),
        sidebar: rect('.editor-sidebar'),
        sidebarFooter: rect('.editor-sidebar-footer'),
        pane: rect('.idea-pane'),
        scroll: rect('.detail-scroll'),
        footer: rect('.detail-footer'),
        pocket: rect('.pocket'),
        pockets: document.querySelectorAll('.pocket').length,
        globalFooter: !!document.querySelector('.library-bottom'),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        paneOverflow:
          document.querySelector('.detail-scroll').scrollWidth >
          document.querySelector('.detail-scroll').clientWidth,
        toolbarOverflow: toolbar.scrollWidth > toolbar.clientWidth,
        titleClipped: title.scrollHeight > title.clientHeight + 1,
        titleLines: title.clientHeight / parseFloat(getComputedStyle(title).lineHeight),
        paper: getComputedStyle(document.querySelector('.idea-pane')).backgroundColor,
        shell: getComputedStyle(document.querySelector('.library-shell')).backgroundColor,
      };
    });
    const close = (a, b) => assert.ok(Math.abs(a - b) <= 1, `${name}: ${a} ≈ ${b}`);
    close(layout.sidebar.top, layout.chrome.bottom);
    close(layout.sidebar.bottom, layout.height);
    close(layout.sidebarFooter.bottom, layout.height);
    close(layout.sidebar.right, layout.pane.left);
    close(layout.pane.right, layout.width);
    close(layout.pane.bottom, layout.height);
    close(layout.scroll.bottom, layout.footer.top);
    assert.equal(layout.pockets, 1);
    assert.equal(layout.globalFooter, false, 'no footer strip across the editor');
    assert.ok(layout.pocket.bottom < layout.height && layout.pocket.left >= 0);
    assert.ok(
      !layout.pageOverflow && !layout.paneOverflow && !layout.toolbarOverflow,
      `${name}: horizontal overflow`,
    );
    assert.equal(layout.titleClipped, false, `${name}: title clips`);
    if (name === 'compact')
      assert.ok(layout.titleLines > 1.5, 'long title wraps in a small window');
    assert.equal(layout.paper, layout.shell, 'writing surface continues to the window edges');
    await screenshot('library', `linen-editor-${name}.png`);
    if (name === 'compact') {
      await click('library', '.editor-sidebar-footer .pocket');
      await until(
        () => evaluate('library', () => !!document.querySelector('.pocket-open-idea')),
        'sidebar pocket preview',
      );
      await evaluate('library', () =>
        Promise.all(
          document
            .querySelector('.pocket-preview')
            .getAnimations()
            .map((a) => a.finished),
        ),
      );
      assert.ok(
        await evaluate('library', () => {
          const preview = document.querySelector('.pocket-preview');
          const rect = preview.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            preview.contains(document.elementFromPoint(rect.right - 8, rect.top + rect.height / 2))
          );
        }),
        'pocket preview stays visible and clickable beyond the sidebar edge',
      );
      await screenshot('library', 'linen-editor-pocket.png');
      await click('library', '[aria-label="Close pocket"]');
    }
    await evaluate('library', () => {
      for (const selector of ['.detail-scroll', '.editor-sidebar-list']) {
        const scroller = document.querySelector(selector);
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    assert.ok(
      await evaluate('library', () => {
        const resources = document.querySelector('.resources').getBoundingClientRect();
        const scroll = document.querySelector('.detail-scroll').getBoundingClientRect();
        const lastIdea = [...document.querySelectorAll('.editor-idea-row')]
          .at(-1)
          .getBoundingClientRect();
        const list = document.querySelector('.editor-sidebar-list').getBoundingClientRect();
        return resources.bottom <= scroll.bottom && lastIdea.bottom <= list.bottom;
      }),
      `${name}: last content is reachable in both panes`,
    );
    if (name === 'compact') await screenshot('library', 'linen-editor-compact-scrolled.png');
  }
  await input('library', '.idea-title', title);
  await evaluate('library', () => {
    document.activeElement.blur();
    document.querySelector('.detail-scroll').scrollTop = 0;
    document.querySelector('.editor-sidebar-list').scrollTop = 0;
  });
  console.log(
    'PASS: continuous editor surfaces at 800×560, 1120×780, and 1600×1000; long-title reflow, reachable content, and no horizontal overflow.',
  );
}
