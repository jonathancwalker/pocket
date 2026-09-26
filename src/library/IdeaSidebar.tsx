import { useCallback, useEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Star, X } from 'lucide-react';
import { api, onNative } from '../bridge';
import { errorText } from '../domain';
import { relativeAge } from '../interaction';
import { defaultFilters, titleOf, type Filters, type Idea, type IdeaPage } from '../types';
import IconButton from '../components/IconButton';
import { fullDate, isFiltered, previewOf } from './browsing';

const sidebarFilters = (filters: Filters): Filters => ({
  ...filters,
  limit: 60,
  offset: Math.floor(filters.offset / 60) * 60,
});

export default function IdeaSidebar({
  selected,
  initialFilters,
  now,
  busy,
  searchInput,
  onSelect,
  onBack,
  footer,
}: {
  selected: Idea;
  initialFilters: Filters;
  now: number;
  busy: boolean;
  searchInput: RefObject<HTMLInputElement | null>;
  onSelect: (id: string) => void;
  onBack: () => void;
  footer: ReactNode;
}) {
  const [filters, setFilters] = useState(() => sidebarFilters(initialFilters));
  const [search, setSearch] = useState(initialFilters.query);
  const [page, setPage] = useState<IdeaPage | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const query = useRef(filters),
    request = useRef(0),
    list = useRef<HTMLDivElement>(null);
  const lastRevealed = useRef<string | null>(null);
  query.current = filters;
  const refresh = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    try {
      const result = await api.list(query.current);
      if (token !== request.current) return;
      if (query.current.offset >= result.total && query.current.offset > 0) {
        setFilters((f) => ({
          ...f,
          offset: Math.max(0, Math.ceil(result.total / f.limit) - 1) * f.limit,
        }));
        return;
      }
      setPage(result);
      setError('');
    } catch (e) {
      if (token === request.current) setError(errorText(e));
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => (f.query === search ? f : { ...f, query: search, offset: 0 })),
      150,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    void refresh();
  }, [filters, refresh]);
  useEffect(() => {
    const off = onNative('library-changed', () => void refresh());
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      request.current++;
      off();
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (lastRevealed.current === selected.id) return;
    const row = list.current?.querySelector<HTMLButtonElement>(
      `[data-sidebar-id="${selected.id}"]`,
    );
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      lastRevealed.current = selected.id;
    }
  }, [selected.id, page]);
  const outsideResults = page !== null && !page.ideas.some((item) => item.id === selected.id);
  function row(item: Idea) {
    const active = item.id === selected.id;
    const note = active ? selected : item;
    const preview = previewOf(note);
    const types = note.tags.filter((tag) => tag.axis === 'type');
    const typeLabel = types.map((tag) => tag.name).join(', ');
    return (
      <button
        key={note.id}
        className={`editor-idea-row ${active ? 'selected' : ''}`}
        data-sidebar-id={note.id}
        aria-current={active ? 'page' : undefined}
        disabled={busy}
        onClick={() => onSelect(note.id)}
        title={`${titleOf(note)}\n${fullDate(note.createdAt)}${typeLabel ? `\nType: ${typeLabel}` : ''}${preview ? `\n${preview}` : ''}`}
      >
        <span className={`editor-idea-title ${note.title?.trim() ? '' : 'untitled'}`}>
          {titleOf(note)}
        </span>
        {!!note.starredAt && (
          <Star size={11} className="sidebar-star wonky-star" aria-label="Starred" />
        )}
        <time dateTime={new Date(note.createdAt).toISOString()}>
          {relativeAge(note.createdAt, now)}
        </time>
        <span
          className="sidebar-type-bars"
          role={types.length ? 'img' : undefined}
          aria-label={types.length ? `Type: ${typeLabel}` : undefined}
          aria-hidden={!types.length || undefined}
        >
          {types.map((tag) => (
            <span
              key={tag.id}
              className={`sidebar-type-bar color-${tag.color || 'neutral'}`}
              aria-hidden="true"
            />
          ))}
        </span>
        {!note.title?.trim() && preview && <span className="sr-only">{preview.slice(0, 160)}</span>}
      </button>
    );
  }
  return (
    <aside className="editor-sidebar" aria-label="Idea sidebar">
      <div className="editor-sidebar-heading">
        <button
          className="back-to-library"
          aria-label="Back to library"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          Library
        </button>
      </div>
      <div className="editor-sidebar-search">
        <Search size={14} />
        <input
          ref={searchInput}
          aria-label="Search sidebar ideas"
          placeholder="Search ideas"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <IconButton label="Clear sidebar search" onClick={() => setSearch('')}>
            <X size={13} />
          </IconButton>
        )}
      </div>
      <div className="editor-sidebar-caption">
        <span>
          {isFiltered(filters)
            ? 'Filtered ideas'
            : filters.view === 'starred'
              ? 'Starred'
              : filters.view === 'archive'
                ? 'Archive'
                : 'Ideas'}
        </span>
        {(isFiltered(filters) || filters.view !== 'active') && (
          <button
            onClick={() => {
              setSearch('');
              setFilters(sidebarFilters(defaultFilters));
            }}
          >
            All ideas
          </button>
        )}
      </div>
      <div className="editor-sidebar-list" ref={list} aria-label="Nearby ideas" aria-busy={loading}>
        {outsideResults && (
          <div className="editor-current-note">
            <span className="editor-sidebar-caption">Current idea</span>
            {row(selected)}
          </div>
        )}
        {page?.ideas.map(row)}
        {loading && !page && (
          <p className="editor-sidebar-empty" role="status">
            Loading…
          </p>
        )}
        {!loading && page?.ideas.length === 0 && (
          <p className="editor-sidebar-empty">
            {isFiltered(filters) ? 'No matches' : 'No other ideas'}
          </p>
        )}
      </div>
      {error && (
        <div className="editor-sidebar-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {!!page && page.total > filters.limit && (
        <nav className="editor-sidebar-pages" aria-label="Sidebar pages">
          <span>
            {filters.offset + 1}–{Math.min(filters.offset + filters.limit, page.total)} of{' '}
            {page.total}
          </span>
          <IconButton
            label="Previous sidebar page"
            disabled={loading || filters.offset === 0}
            onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton
            label="Next sidebar page"
            disabled={loading || filters.offset + filters.limit >= page.total}
            onClick={() => setFilters((f) => ({ ...f, offset: f.offset + f.limit }))}
          >
            <ChevronRight size={15} />
          </IconButton>
        </nav>
      )}
      <footer className="editor-sidebar-footer">{footer}</footer>
    </aside>
  );
}
