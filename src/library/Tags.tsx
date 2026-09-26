import { useState } from 'react';
import { Check, Plus, Pencil, Trash2, X } from 'lucide-react';
import { call } from '../bridge';
import type { Tag } from '../types';
import { errorText } from '../domain';
import IconButton from '../components/IconButton';
export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className={`tag-chip ${tag.axis === 'type' ? `color-${tag.color}` : 'topic-chip'}`}>
      {tag.name}
      {onRemove && (
        <button
          aria-label={`Remove ${tag.name} tag`}
          title={`Remove ${tag.name}`}
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
export default function Tags({
  axis,
  tags,
  selected,
  onToggle,
  onChanged,
  onDelete,
}: {
  axis: 'type' | 'topic';
  tags: Tag[];
  selected: Tag[];
  onToggle: (tag: Tag, enabled: boolean) => Promise<void>;
  onChanged: () => void;
  onDelete?: (tag: Tag) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<Tag | null>(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false);
  const filtered = tags.filter(
    (t) => t.axis === axis && t.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function create() {
    setBusy(true);
    setError('');
    try {
      const tag = await call<Tag>('create_tag', { axis, name: query });
      onChanged();
      await onToggle(tag, true);
      setQuery('');
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tag-axis">
      <span className="eyebrow">{axis === 'type' ? 'Type' : 'Topic'}</span>
      <div className="tag-pills">
        {selected
          .filter((t) => t.axis === axis)
          .map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              onRemove={() => void onToggle(tag, false).catch((e) => setError(errorText(e)))}
            />
          ))}
        <button
          className="add-tag"
          title={`Add ${axis}`}
          aria-label={`Add ${axis}`}
          onClick={() => {
            setOpen((v) => !v);
            setError('');
            setEditing(null);
          }}
        >
          <Plus size={13} />
          {selected.some((t) => t.axis === axis) ? '' : 'Add'}
        </button>
      </div>
      {open && (
        <>
          <button
            className="popover-backdrop"
            aria-label="Close tag picker"
            onClick={() => setOpen(false)}
          />
          <div
            className="tag-popover"
            role="dialog"
            aria-label={`Choose ${axis}`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          >
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  void call('rename_tag', { id: editing.id, name })
                    .then(() => {
                      setEditing(null);
                      onChanged();
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <label>Rename {editing.name}</label>
                <input
                  autoFocus
                  aria-label="Tag name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                />
                <div className="popover-actions">
                  <button disabled={busy} type="submit">
                    Save name
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <input
                  aria-label={`Find or create ${axis}`}
                  autoFocus
                  placeholder={`Find or create a ${axis}…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim() && !filtered.length) {
                      e.preventDefault();
                      void create();
                    }
                  }}
                />
                <div className="tag-options">
                  {filtered.map((tag) => (
                    <div key={tag.id} className="tag-option">
                      <button
                        onClick={() => {
                          void onToggle(tag, !selected.some((t) => t.id === tag.id))
                            .then(() => setOpen(false))
                            .catch((e) => setError(errorText(e)));
                        }}
                      >
                        <span>{tag.name}</span>
                        {selected.some((t) => t.id === tag.id) && <Check size={14} />}
                      </button>
                      <IconButton
                        label={`Rename ${tag.name}`}
                        onClick={() => {
                          setEditing(tag);
                          setName(tag.name);
                        }}
                      >
                        <Pencil size={13} />
                      </IconButton>
                      {axis === 'type' && onDelete && (
                        <IconButton label={`Delete ${tag.name}`} onClick={() => onDelete(tag)}>
                          <Trash2 size={13} />
                        </IconButton>
                      )}
                    </div>
                  ))}
                </div>
                {query.trim() &&
                  !tags.some(
                    (t) =>
                      t.axis === axis &&
                      t.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
                  ) && (
                    <button className="create-tag" disabled={busy} onClick={() => void create()}>
                      <Plus size={14} />
                      Create “{query.trim()}”
                    </button>
                  )}
              </>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
