import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  Settings2,
  Star,
  X,
} from 'lucide-react';
import { api, call, onNative } from '../bridge';
import { errorText, readableText, WriteQueue } from '../domain';
import {
  defaultFilters,
  type Idea,
  type IdeaPage,
  type Filters,
  type JsonNode,
  type Tag,
  type Settings as Preferences,
} from '../types';
import IconButton from '../components/IconButton';
import WritingEditor from './Editor';
import Tags from './Tags';
import Resources from './Resources';
import Settings from '../settings/Settings';
import Browse from './Browse';
import IdeaSidebar from './IdeaSidebar';
import IdeaTitle from './IdeaTitle';
import Pocket from './Pocket';
import { fullDate } from './browsing';
import '../styles/library.css';
import { recordStroke, shortcutKeys } from '../settings/shortcuts';

export default function Library() {
  const [now, setNow] = useState(Date.now());
  const captureShortcut = useRef('CommandOrControl+Shift+Space');
  const [filters, setFilters] = useState<Filters>(defaultFilters),
    [search, setSearch] = useState(''),
    [pocketIdeas, setPocketIdeas] = useState(true);
  const [starBusy, setStarBusy] = useState(false);
  const starring = useRef(false);
  const [layout, setLayout] = useState<'list' | 'grid'>(() => {
    try {
      return localStorage.getItem('library-layout') === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  function changeLayout(value: 'list' | 'grid') {
    setLayout(value);
    try {
      localStorage.setItem('library-layout', value);
    } catch {
      /* Layout still works without persistence. */
    }
  }
  const [page, setPage] = useState<IdeaPage>({
      ideas: [],
      total: 0,
      active: 0,
      starred: 0,
      archived: 0,
    }),
    [tags, setTags] = useState<Tag[]>([]);
  const [idea, setIdea] = useState<Idea | null>(null),
    [loading, setLoading] = useState(true),
    [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => Promise<void> } | null>(null),
    [navBusy, setNavBusy] = useState(false);
  const current = useRef<Idea | null>(null),
    editVersion = useRef(0),
    savedVersion = useRef(0),
    queue = useRef(new WriteQueue()),
    revisions = useRef(new Map<string, number>());
  const autosave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filtersRef = useRef(filters),
    requestNumber = useRef(0),
    searchInput = useRef<HTMLInputElement>(null),
    editorSearchInput = useRef<HTMLInputElement>(null),
    navigating = useRef(false),
    flushing = useRef<Promise<void> | null>(null);
  const actions = useRef({
    flush: async () => {},
    refresh: async () => {},
    capture: async () => {},
    close: async () => {},
  });
  filtersRef.current = filters;
  const refresh = useCallback(async () => {
    const number = ++requestNumber.current;
    try {
      const [data, newTags] = await Promise.all([api.list(filtersRef.current), api.tags()]);
      if (number !== requestNumber.current) return;
      if (filtersRef.current.offset >= data.total && filtersRef.current.offset > 0) {
        setFilters((f) => ({
          ...f,
          offset: Math.max(0, Math.ceil(data.total / f.limit) - 1) * f.limit,
        }));
        return;
      }
      setPage(data);
      setTags(newTags);
      setLoading(false);
    } catch (e) {
      if (number === requestNumber.current) {
        setError(errorText(e));
        setLoading(false);
      }
    }
  }, []);
  function notify(message: string, undo?: () => Promise<void>) {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  }
  function assign(i: Idea | null) {
    current.current = i;
    setIdea(i);
    if (i) revisions.current.set(i.id, i.revision);
  }
  function edit(update: Partial<Idea>) {
    if (!current.current) return;
    assign({ ...current.current, ...update });
    editVersion.current++;
    setStatus('unsaved');
    setError('');
    clearTimeout(autosave.current);
    autosave.current = setTimeout(() => void flush().catch(() => {}), 500);
  }
  function flush(): Promise<void> {
    clearTimeout(autosave.current);
    if (flushing.current) return flushing.current;
    const task = (async () => {
      try {
        while (current.current && editVersion.current > savedVersion.current) {
          const snapshot = current.current,
            version = editVersion.current;
          setStatus('saving');
          const persisted = await queue.current.run(() =>
            api.content({
              ...snapshot,
              revision: revisions.current.get(snapshot.id) ?? snapshot.revision,
            }),
          );
          revisions.current.set(persisted.id, persisted.revision);
          if (current.current?.id === persisted.id) {
            savedVersion.current = version;
            assign({
              ...current.current,
              revision: persisted.revision,
              contentUpdatedAt: persisted.contentUpdatedAt,
              updatedAt: persisted.updatedAt,
            });
          }
        }
        setStatus('saved');
        setError('');
      } catch (e) {
        setStatus('error');
        setError(errorText(e));
        throw e;
      }
    })();
    flushing.current = task;
    void task
      .finally(() => {
        flushing.current = null;
      })
      .catch(() => {});
    return task;
  }
  async function select(id: string) {
    if (current.current?.id === id || navigating.current) return;
    navigating.current = true;
    setNavBusy(true);
    try {
      await flush();
      const loaded = await api.idea(id);
      assign(loaded);
      editVersion.current = 0;
      savedVersion.current = 0;
      setStatus('saved');
      setError('');
      requestAnimationFrame(() => {
        document.querySelector('.detail-scroll')?.scrollTo({ top: 0 });
        document.querySelector<HTMLTextAreaElement>('.idea-title')?.focus();
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      navigating.current = false;
      setNavBusy(false);
    }
  }
  async function star(item: Idea) {
    if (starring.current) return;
    starring.current = true;
    setStarBusy(true);
    try {
      await mutate('set_starred', { enabled: !item.starredAt }, item.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      starring.current = false;
      setStarBusy(false);
    }
  }
  async function mutate(
    operation: string,
    input: Record<string, unknown>,
    id = current.current?.id,
  ): Promise<void> {
    if (!id) return;
    await flush();
    const result = await queue.current.run(() => call<Idea>(operation, { ...input, id }));
    revisions.current.set(result.id, result.revision);
    if (current.current?.id === result.id)
      assign({
        ...result,
        title: current.current.title,
        captureText: current.current.captureText,
        body: current.current.body,
      });
    await refresh();
  }
  async function capture() {
    try {
      await flush();
      await api.action('capture');
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function close() {
    try {
      await flush();
      await api.action('dismiss');
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function archive() {
    if (!current.current) return;
    const snapshot = current.current,
      enabled = !snapshot.archivedAt;
    try {
      await mutate('set_archived', { enabled });
      notify(enabled ? 'Archived' : 'Restored', async () => {
        await call('set_archived', { id: snapshot.id, enabled: !enabled });
        if (current.current?.id === snapshot.id) {
          const fresh = await api.idea(snapshot.id);
          assign({
            ...fresh,
            title: current.current.title,
            captureText: current.current.captureText,
            body: current.current.body,
          });
        }
        await refresh();
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  actions.current = { flush, refresh, capture, close };
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, query: search, offset: 0 })), 150);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    void refresh();
  }, [filters, refresh]);
  useEffect(() => {
    const unsubscribers = [
      onNative<Preferences>('settings-changed', (s) => {
        captureShortcut.current = s.shortcut;
        setPocketIdeas(s.pocketIdeas !== false);
      }),
      onNative('library-changed', () => void actions.current.refresh()),
      onNative('request-close', () => void actions.current.close()),
      onNative<{ token: number }>('prepare-quit', ({ token }) => {
        void actions.current
          .flush()
          .then(() => api.quitAck(token, true))
          .catch(() => api.quitAck(token, false));
      }),
    ];
    void api
      .settings()
      .then((s) => {
        captureShortcut.current = s.shortcut;
        setPocketIdeas(s.pocketIdeas !== false);
      })
      .catch(() => {});
    const ageTimer = setInterval(() => setNow(Date.now()), 60_000);
    void api.ready().catch((e) => setError(errorText(e)));
    const focus = () => void actions.current.refresh();
    window.addEventListener('focus', focus);
    const keyboard = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || document.querySelector('.settings-modal')) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 's' || e.key === 'Enter') {
          e.preventDefault();
          void actions.current
            .flush()
            .then(() => notify('Saved'))
            .catch(() => {});
        }
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          if (
            shortcutKeys(recordStroke(e).value).join('') ===
            shortcutKeys(captureShortcut.current).join('')
          )
            return;
          void actions.current.capture();
        }
        if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          (current.current ? editorSearchInput.current : searchInput.current)?.focus();
        }
        if (e.key.toLowerCase() === 'w') {
          e.preventDefault();
          void actions.current.close();
        }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      clearInterval(ageTimer);
      unsubscribers.forEach((fn) => fn());
      clearTimeout(autosave.current);
      clearTimeout(toastTimer.current);
      window.removeEventListener('focus', focus);
      window.removeEventListener('keydown', keyboard);
    };
  }, []);
  const selectedTags = idea?.tags.map((tag) => tags.find((t) => t.id === tag.id) || tag) ?? [];
  async function back() {
    if (navigating.current) return;
    navigating.current = true;
    const previous = current.current?.id;
    setNavBusy(true);
    try {
      await flush();
      assign(null);
      await refresh();
      requestAnimationFrame(() => {
        const row = previous
          ? document.querySelector<HTMLButtonElement>(`[data-idea-id="${previous}"]`)
          : null;
        (row || searchInput.current)?.focus({ preventScroll: true });
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      navigating.current = false;
      setNavBusy(false);
    }
  }
  return (
    <div className="library-shell" data-view={idea ? 'editor' : 'browse'}>
      <div className="library-chrome" data-tauri-drag-region>
        <div className="chrome-actions">
          <button
            className="new-idea-button icon-button"
            aria-label="New idea"
            title="New idea · ⌘N"
            onClick={() => void capture()}
          >
            <Plus size={18} />
          </button>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={17} />
          </IconButton>
        </div>
      </div>
      <section className="browse-pane" hidden={!!idea} aria-label="Browse library">
        <Browse
          filters={filters}
          setFilters={setFilters}
          search={search}
          setSearch={setSearch}
          searchInput={searchInput}
          page={page}
          tags={tags}
          now={now}
          loading={loading}
          busy={navBusy || starBusy}
          onSelect={(id) => void select(id)}
          onStar={(item) => void star(item)}
          layout={layout}
          setLayout={changeLayout}
        />
      </section>
      <div className="editor-workspace" hidden={!idea}>
        {idea && (
          <IdeaSidebar
            selected={{ ...idea, tags: selectedTags }}
            initialFilters={filters}
            now={now}
            busy={navBusy}
            searchInput={editorSearchInput}
            onSelect={(id) => void select(id)}
            onBack={() => void back()}
            footer={
              <Pocket enabled={pocketIdeas} active={page.active} onOpen={(id) => void select(id)} />
            }
          />
        )}
        <main className="idea-pane">
          {idea ? (
            <>
              <div className="detail-scroll" inert={navBusy}>
                <article className="idea-detail">
                  <div className="idea-kicker">
                    <time className="idea-date" dateTime={new Date(idea.createdAt).toISOString()}>
                      {fullDate(idea.createdAt)}
                    </time>
                    <div className="state-actions">
                      <IconButton
                        label={idea.starredAt ? 'Unstar idea' : 'Star idea'}
                        aria-pressed={!!idea.starredAt}
                        className={idea.starredAt ? 'is-starred' : ''}
                        onClick={() =>
                          void mutate('set_starred', { enabled: !idea.starredAt }).catch((e) =>
                            setError(errorText(e)),
                          )
                        }
                      >
                        <Star size={19} />
                      </IconButton>
                      <button
                        className="archive-button icon-button"
                        aria-label={idea.archivedAt ? 'Restore idea' : 'Archive idea'}
                        title={idea.archivedAt ? 'Restore idea' : 'Archive idea'}
                        onClick={() => void archive()}
                      >
                        <Archive size={18} />
                      </button>
                    </div>
                  </div>
                  <IdeaTitle value={idea.title ?? ''} onChange={(title) => edit({ title })} />
                  <div className="idea-tags">
                    <Tags
                      axis="type"
                      tags={tags}
                      selected={selectedTags}
                      onToggle={(tag, enabled) => mutate('set_tag', { tagId: tag.id, enabled })}
                      onChanged={() => void refresh()}
                    />
                    <Tags
                      axis="topic"
                      tags={tags}
                      selected={selectedTags}
                      onToggle={(tag, enabled) => mutate('set_tag', { tagId: tag.id, enabled })}
                      onChanged={() => void refresh()}
                    />
                  </div>
                  <WritingEditor
                    id={idea.id}
                    body={idea.body}
                    onChange={(body: JsonNode) => edit({ body })}
                  />
                  <Resources
                    key={idea.id}
                    links={idea.links}
                    onAdd={(link) => mutate('add_link', { link })}
                    onRemove={(linkId) => mutate('remove_link', { linkId })}
                  />
                </article>
              </div>
              <footer className="detail-footer">
                <div className={`save-state ${status}`} role="status">
                  {status === 'saving' ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : status === 'saved' ? (
                    <Check size={14} />
                  ) : (
                    <span className="status-dot" />
                  )}
                  {status === 'saved'
                    ? 'Saved'
                    : status === 'saving'
                      ? 'Saving…'
                      : status === 'error'
                        ? 'Changes need saving'
                        : 'Unsaved changes'}
                </div>
              </footer>
            </>
          ) : null}
        </main>
      </div>
      {!idea && (
        <footer className="library-bottom">
          <Pocket enabled={pocketIdeas} active={page.active} onOpen={(id) => void select(id)} />
          {!idea && page.total > filters.limit && (
            <nav className="browse-pagination" aria-label="Pages">
              <span>
                {filters.offset + 1}–{Math.min(filters.offset + filters.limit, page.total)} of{' '}
                {page.total}
              </span>
              <IconButton
                label="Previous page"
                disabled={filters.offset === 0}
                onClick={() =>
                  setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))
                }
              >
                <ChevronLeft size={17} />
              </IconButton>
              <IconButton
                label="Next page"
                disabled={filters.offset + filters.limit >= page.total}
                onClick={() => setFilters((f) => ({ ...f, offset: f.offset + f.limit }))}
              >
                <ChevronRight size={17} />
              </IconButton>
            </nav>
          )}
        </footer>
      )}
      {error && (
        <div className="library-error" role="alert">
          <span>{error}</span>
          <button
            onClick={() =>
              void flush()
                .then(() => refresh())
                .catch(() => {})
            }
          >
            Retry save
          </button>
          {idea && (
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    `${current.current?.title || ''}\n\n${current.current ? readableText(current.current.body) : ''}`,
                  )
                  .then(() => notify('Copied'))
                  .catch((e) => setError(errorText(e)))
              }
            >
              Copy writing
            </button>
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                void undo?.().catch((e) => setError(errorText(e)));
              }}
            >
              Undo
            </button>
          )}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} beforeExport={flush} />}
    </div>
  );
}
