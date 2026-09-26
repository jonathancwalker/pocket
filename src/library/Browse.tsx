import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  Grid2X2,
  Inbox,
  Link2,
  List,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  defaultFilters,
  titleOf,
  type Filters,
  type Idea,
  type IdeaPage,
  type Tag,
} from '../types';
import { relativeAge } from '../interaction';
import {
  dateBoundary,
  dateInput,
  fullDate,
  isFiltered,
  presetBounds,
  previewOf,
  timeGroup,
  type DatePreset,
} from './browsing';
import IconButton from '../components/IconButton';

export function TypeLabels({ tags }: { tags: Tag[] }) {
  return (
    <span className="type-labels">
      {tags
        .filter((t) => t.axis === 'type')
        .map((tag) => (
          <span key={tag.id} className={`cloth color-${tag.color || 'neutral'}`}>
            {tag.name}
          </span>
        ))}
    </span>
  );
}
export default function Browse({
  filters,
  setFilters,
  search,
  setSearch,
  searchInput,
  page,
  tags,
  now,
  loading,
  busy,
  onSelect,
  onStar,
  onDelete,
  layout,
  setLayout,
}: {
  filters: Filters;
  setFilters: (update: (f: Filters) => Filters) => void;
  search: string;
  setSearch: (value: string) => void;
  searchInput: RefObject<HTMLInputElement | null>;
  page: IdeaPage;
  tags: Tag[];
  now: number;
  loading: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onStar: (idea: Idea) => void;
  onDelete: (idea: Idea) => void;
  layout: 'list' | 'grid';
  setLayout: (value: 'list' | 'grid') => void;
}) {
  const [open, setOpen] = useState(false),
    [preset, setPreset] = useState<DatePreset>('any');
  const filterArea = useRef<HTMLDivElement>(null),
    filterButton = useRef<HTMLButtonElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const filtered = isFiltered(filters);
  const count =
    filters.types.length +
    filters.topics.length +
    Number(filters.noType) +
    Number(filters.hasLinks) +
    Number(filters.from !== null || filters.to !== null);
  const patch = (update: Partial<Filters>) => setFilters((f) => ({ ...f, ...update, offset: 0 }));
  const reset = () => {
    setSearch('');
    setPreset('any');
    setFilters((f) => ({ ...defaultFilters, view: f.view, sort: f.sort }));
  };
  const toggleTag = (tag: Tag) => {
    const field = tag.axis === 'type' ? 'types' : 'topics';
    patch({
      [field]: filters[field].includes(tag.id)
        ? filters[field].filter((id) => id !== tag.id)
        : [...filters[field], tag.id],
    });
  };
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [filters]);
  useEffect(() => {
    if (preset === 'any' || preset === 'range') return;
    const bounds = presetBounds(preset, now);
    setFilters((f) =>
      f.from === bounds.from && f.to === bounds.to ? f : { ...f, ...bounds, offset: 0 },
    );
  }, [now, preset, setFilters]);
  useEffect(() => {
    if (!open) return;
    filterArea.current?.querySelector<HTMLButtonElement>('[aria-label="Close filters"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !filterArea.current?.contains(e.target as Node) &&
        !filterButton.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        filterButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  let previousGroup = '';
  return (
    <>
      <header className="browse-header">
        <div className="browse-heading">
          <h1>Pocket</h1>
        </div>
        <div className="browse-toolbar">
          <nav className="library-views" aria-label="Library views">
            {(
              [
                ['active', 'All', Inbox, page.active],
                ['starred', 'Starred', Star, page.starred],
                ['archive', 'Archive', Archive, page.archived],
              ] as const
            ).map(([value, label, Icon, total]) => (
              <button
                key={value}
                className={filters.view === value ? 'active' : ''}
                aria-current={filters.view === value ? 'page' : undefined}
                title={`${label}: ${total} ideas`}
                onClick={() => patch({ view: value })}
              >
                <Icon size={15} className={value === 'starred' ? 'wonky-star' : ''} />
                {label}
              </button>
            ))}
          </nav>
          <div className="browse-tools">
            <div className="browse-search">
              <Search size={16} />
              <input
                ref={searchInput}
                aria-label="Search ideas"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <IconButton label="Clear search" onClick={() => setSearch('')}>
                  <X size={14} />
                </IconButton>
              )}
            </div>
            <button
              ref={filterButton}
              className="filter-trigger"
              aria-label="Filter ideas"
              aria-expanded={open}
              aria-controls="browse-filters"
              onClick={() => setOpen((v) => !v)}
            >
              <SlidersHorizontal size={15} />
              Filter{count > 0 && <span className="filter-number">{count}</span>}
            </button>
            <div className="layout-toggle" aria-label="Layout">
              <IconButton
                label="List view"
                aria-pressed={layout === 'list'}
                onClick={() => setLayout('list')}
              >
                <List size={17} />
              </IconButton>
              <IconButton
                label="Grid view"
                aria-pressed={layout === 'grid'}
                onClick={() => setLayout('grid')}
              >
                <Grid2X2 size={16} />
              </IconButton>
            </div>
          </div>
        </div>
        {count > 0 && (
          <div className="active-filters" aria-label="Active filters">
            {tags
              .filter((t) => (t.axis === 'type' ? filters.types : filters.topics).includes(t.id))
              .map((t) => (
                <button
                  key={t.id}
                  className={`cloth color-${t.color || 'neutral'}`}
                  aria-label={`Remove ${t.name} filter`}
                  onClick={() => toggleTag(t)}
                >
                  {t.name}
                  <X size={11} />
                </button>
              ))}
            {filters.noType && (
              <button
                className="cloth"
                onClick={() => patch({ noType: false })}
                aria-label="Remove No type filter"
              >
                No type
                <X size={11} />
              </button>
            )}
            {filters.hasLinks && (
              <button
                className="cloth"
                onClick={() => patch({ hasLinks: false })}
                aria-label="Remove Has links filter"
              >
                <Link2 size={13} />
                Has links
                <X size={11} />
              </button>
            )}
            {(filters.from !== null || filters.to !== null) && (
              <button
                className="cloth"
                onClick={() => {
                  setPreset('any');
                  patch({ from: null, to: null });
                }}
                aria-label="Remove date filter"
              >
                <CalendarDays size={13} />
                {preset === 'today'
                  ? 'Today'
                  : preset === 'week'
                    ? 'This week'
                    : preset === 'month'
                      ? 'This month'
                      : `${dateInput(filters.from) || 'Any time'} – ${dateInput(filters.to === null ? null : filters.to - 1) || 'Now'}`}
                <X size={11} />
              </button>
            )}
          </div>
        )}
        {open && (
          <div
            ref={filterArea}
            id="browse-filters"
            className="browse-filter-panel"
            role="dialog"
            aria-label="Filter ideas"
          >
            <div className="filter-panel-heading">
              <strong>Filters</strong>
              <IconButton
                label="Close filters"
                onClick={() => {
                  setOpen(false);
                  filterButton.current?.focus();
                }}
              >
                <X size={16} />
              </IconButton>
            </div>
            {(['type', 'topic'] as const).map((axis) => (
              <fieldset className="filter-group" key={axis}>
                <legend>{axis === 'type' ? 'Type' : 'Topic'}</legend>
                <div className="filter-choices">
                  {tags
                    .filter((t) => t.axis === axis)
                    .map((t) => (
                      <label className={`filter-choice color-${t.color || 'neutral'}`} key={t.id}>
                        <input
                          type="checkbox"
                          checked={(axis === 'type' ? filters.types : filters.topics).includes(
                            t.id,
                          )}
                          onChange={() => toggleTag(t)}
                        />
                        {t.name}
                      </label>
                    ))}
                  {axis === 'type' && (
                    <label className="filter-choice">
                      <input
                        type="checkbox"
                        checked={filters.noType}
                        onChange={(e) => patch({ noType: e.target.checked })}
                      />
                      No type
                    </label>
                  )}
                  {axis === 'topic' && !tags.some((t) => t.axis === 'topic') && (
                    <span className="filter-hint">No topics yet</span>
                  )}
                </div>
              </fieldset>
            ))}
            <fieldset className="filter-group">
              <legend>
                <CalendarDays size={13} />
                Captured
              </legend>
              <select
                aria-label="Captured date"
                value={preset}
                onChange={(e) => {
                  const value = e.target.value as DatePreset;
                  setPreset(value);
                  patch(presetBounds(value));
                }}
              >
                <option value="any">Any time</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="range">Date range</option>
              </select>
              {preset === 'range' && (
                <div className="date-range">
                  <label>
                    From
                    <input
                      type="date"
                      aria-label="Captured from date"
                      value={dateInput(filters.from)}
                      max={dateInput(filters.to === null ? null : filters.to - 1)}
                      onChange={(e) => patch({ from: dateBoundary(e.target.value) })}
                    />
                  </label>
                  <label>
                    Through
                    <input
                      type="date"
                      aria-label="Captured through date"
                      min={dateInput(filters.from)}
                      value={dateInput(filters.to === null ? null : filters.to - 1)}
                      onChange={(e) => patch({ to: dateBoundary(e.target.value, true) })}
                    />
                  </label>
                </div>
              )}
              {filters.from !== null && filters.to !== null && filters.from >= filters.to && (
                <p className="field-error" role="alert">
                  Choose an end date on or after the start.
                </p>
              )}
            </fieldset>
            <fieldset className="filter-group">
              <legend>References</legend>
              <label className="filter-choice">
                <input
                  type="checkbox"
                  checked={filters.hasLinks}
                  onChange={(e) => patch({ hasLinks: e.target.checked })}
                />
                <Link2 size={13} />
                Has links
              </label>
            </fieldset>
            <div className="filter-panel-footer">
              <button onClick={reset}>Reset</button>
              <button
                className="cloth"
                onClick={() => {
                  setOpen(false);
                  filterButton.current?.focus();
                }}
              >
                <Check size={13} />
                Done
              </button>
            </div>
          </div>
        )}
      </header>
      <div className="browse-scroll" ref={scroll}>
        <div className="list-caption">
          <span role="status">
            {loading
              ? 'Loading…'
              : `${page.total} ${filtered ? (page.total === 1 ? 'match' : 'matches') : page.total === 1 ? 'idea' : 'ideas'}`}
          </span>
        </div>
        {!loading && !page.ideas.length ? (
          <div className="library-welcome">
            <p>
              {filtered
                ? 'No matches'
                : filters.view === 'starred'
                  ? 'No starred ideas'
                  : filters.view === 'archive'
                    ? 'No archived ideas'
                    : 'No ideas yet'}
            </p>
            {filtered && (
              <button className="cloth" onClick={reset}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className={layout === 'list' ? 'idea-ledger' : 'idea-grid'} aria-label="Ideas">
            {page.ideas.map((item) => {
              const group = timeGroup(item.createdAt, now),
                showGroup =
                  filters.view === 'active' &&
                  !filtered &&
                  filters.sort === 'newest' &&
                  group !== previousGroup;
              previousGroup = group;
              const preview = previewOf(item);
              const naming = item.titleStatus === 'pending';
              const displayTitle = naming ? 'Naming…' : titleOf(item);
              return (
                <Fragment key={item.id}>
                  {showGroup && <h2 className="time-group">{group}</h2>}
                  <article
                    className={`${layout === 'list' ? 'browse-row' : 'idea-card'} ${filters.view === 'archive' ? 'archived-idea' : ''}`}
                  >
                    <IconButton
                      label={`${item.starredAt ? 'Unstar' : 'Star'} ${displayTitle}`}
                      aria-pressed={!!item.starredAt}
                      className={`browse-star ${item.starredAt ? 'is-starred' : ''}`}
                      onClick={() => onStar(item)}
                      disabled={busy}
                    >
                      <Star size={17} className="wonky-star" />
                    </IconButton>
                    {filters.view === 'archive' && (
                      <IconButton
                        label={`Delete ${displayTitle}`}
                        className="browse-delete"
                        onClick={() => onDelete(item)}
                        disabled={busy}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                    <button
                      className={`idea-row ${layout === 'grid' ? 'card-open' : 'row-open'}`}
                      disabled={busy}
                      data-idea-id={item.id}
                      onClick={() => {
                        setOpen(false);
                        onSelect(item.id);
                      }}
                      aria-label={`Open ${displayTitle}`}
                    >
                      {layout === 'grid' && <TypeLabels tags={item.tags} />}
                      <span className="idea-primary">
                        <span
                          className={`idea-row-title ${naming ? 'naming' : item.title?.trim() ? '' : 'untitled'} ${item.titleStatus === 'generated' ? 'title-arrived' : ''}`}
                        >
                          {displayTitle}
                        </span>
                        {preview && (layout === 'grid' || naming || !item.title?.trim()) && (
                          <span className="idea-excerpt">{preview}</span>
                        )}
                      </span>
                      {layout === 'list' && <TypeLabels tags={item.tags} />}
                      <time
                        className="idea-age"
                        dateTime={new Date(item.createdAt).toISOString()}
                        title={fullDate(item.createdAt)}
                      >
                        {relativeAge(item.createdAt, now)}
                      </time>
                    </button>
                  </article>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
