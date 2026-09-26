import { useState } from 'react';
import { Plus, Link2, ExternalLink, Copy, X, ArrowRight } from 'lucide-react';
import { api } from '../bridge';
import { parseLink, errorText } from '../domain';
import type { Reference } from '../types';
import IconButton from '../components/IconButton';
export default function Resources({
  links,
  onAdd,
  onRemove,
}: {
  links: Reference[];
  onAdd: (link: Reference) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState<string | null>(null);
  async function add() {
    setError('');
    setBusy(true);
    try {
      const link = parseLink(url);
      if (links.some((l) => l.key === link.key)) {
        setError('That link is already here.');
        return;
      }
      await onAdd(link);
      setUrl('');
      setAdding(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="resources">
      <div className="section-heading">
        <h2>Links</h2>
        <button className="text-button" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} />
          Add link
        </button>
      </div>
      <div className="resource-list">
        {links.map((link) => (
          <div className="resource-row" key={link.id}>
            <span className="resource-symbol">
              <Link2 size={17} />
            </span>
            <button
              className="resource-main"
              title={link.url}
              onClick={() => void api.openLink(link.url).catch((e) => setError(errorText(e)))}
            >
              <strong>{link.hostname}</strong>
              <span>{link.url}</span>
            </button>
            <div className="resource-actions">
              <IconButton
                label={`Open ${link.hostname}`}
                onClick={() => void api.openLink(link.url).catch((e) => setError(errorText(e)))}
              >
                <ExternalLink size={15} />
              </IconButton>
              <IconButton
                label={copied === link.id ? 'Copied' : `Copy ${link.hostname} link`}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(link.url)
                    .then(() => {
                      setCopied(link.id);
                      setTimeout(() => setCopied(null), 1500);
                    })
                    .catch((e) => setError(errorText(e)))
                }
              >
                <Copy size={15} />
              </IconButton>
              <IconButton
                label={`Remove ${link.hostname} link`}
                onClick={() => void onRemove(link.id).catch((e) => setError(errorText(e)))}
              >
                <X size={15} />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
      {adding && (
        <form
          className="resource-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Link2 size={16} />
          <input
            aria-label="Resource URL"
            autoFocus
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button disabled={busy || !url.trim()} title="Add reference" aria-label="Add reference">
            <ArrowRight size={17} />
          </button>
          <button type="button" aria-label="Cancel reference" onClick={() => setAdding(false)}>
            <X size={16} />
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
