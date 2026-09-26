import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Heart, Leaf, RotateCw, Star, X } from 'lucide-react';
import { api } from '../bridge';
import { errorText } from '../domain';
import { titleOf, type Idea } from '../types';
import { previewOf } from './browsing';
import { TypeLabels } from './Browse';
import IconButton from '../components/IconButton';

export default function Pocket({
  enabled,
  active,
  onOpen,
}: {
  enabled: boolean;
  active: number;
  onOpen: (id: string) => void;
}) {
  const [revealed, setRevealed] = useState(false),
    [idea, setIdea] = useState<Idea | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [keepsake, setKeepsake] = useState(0);
  const dock = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    request = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function close() {
    request.current++;
    setBusy(false);
    setRevealed(false);
    clearTimeout(timer.current);
  }
  useEffect(() => {
    close();
    setIdea(null);
    return () => {
      request.current++;
      clearTimeout(timer.current);
    };
  }, [enabled]);
  useEffect(() => {
    if (!revealed) return;
    const outside = (e: PointerEvent) => {
      if (!dock.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [revealed]);
  async function pull(exclude: string | null = null) {
    const token = ++request.current;
    setBusy(true);
    setError('');
    setRevealed(true);
    try {
      const found = await api.randomIdea(exclude);
      if (token !== request.current) return;
      if (found || !exclude) setIdea(found);
      else setError('No other ideas yet.');
    } catch (e) {
      if (token === request.current) setError(errorText(e));
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  const Keepsake = [Star, Heart, Leaf][keepsake % 3];
  return (
    <div className="pocket-dock" ref={dock}>
      {enabled && revealed && (
        <section className="pocket-preview" aria-label="From your pocket" aria-busy={busy}>
          <div className="pocket-preview-top">
            <span>From your pocket</span>
            <IconButton
              label="Close pocket"
              onClick={() => {
                close();
                button.current?.focus();
              }}
            >
              <X size={15} />
            </IconButton>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {busy ? (
            <p role="status">Finding an idea…</p>
          ) : idea ? (
            <>
              <button
                className="pocket-open-idea"
                onClick={() => {
                  close();
                  onOpen(idea.id);
                }}
              >
                <TypeLabels tags={idea.tags} />
                <strong>{titleOf(idea)}</strong>
                {previewOf(idea) && <span className="idea-excerpt">{previewOf(idea)}</span>}
                <span className="pocket-open-label">
                  Open idea
                  <ArrowRight size={13} />
                </span>
              </button>
              {active > 1 && (
                <button className="pocket-another" onClick={() => void pull(idea.id)}>
                  <RotateCw size={13} />
                  Another
                </button>
              )}
            </>
          ) : (
            !error && <p>No ideas tucked away yet.</p>
          )}
          {error && <button onClick={() => void pull(idea?.id ?? null)}>Try again</button>}
        </section>
      )}
      <button
        ref={button}
        className={`pocket ${revealed ? 'is-revealed' : ''} ${!enabled && revealed ? 'keepsake-reveal' : ''}`}
        aria-label={enabled ? 'Pull an idea' : 'Peek inside'}
        aria-expanded={enabled ? revealed : undefined}
        onClick={() => {
          if (revealed) {
            close();
            return;
          }
          if (enabled) void pull();
          else {
            setKeepsake((k) => k + 1);
            setRevealed(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setRevealed(false), 3000);
          }
        }}
      >
        <span className="pocket-object" aria-hidden="true">
          <span className="pocket-back" />
          <span className="pocket-slip">
            <Keepsake size={15} className={keepsake % 3 === 0 ? 'wonky-star' : ''} />
          </span>
          <span className="pocket-front" />
        </span>
        {!revealed && (
          <span className="pocket-hint" aria-hidden="true">
            {enabled ? 'Pull an idea' : 'Peek inside'}
          </span>
        )}
      </button>
      <span className="sr-only" role="status">
        {!enabled && revealed
          ? ['A little star', 'A little heart', 'A little leaf'][keepsake % 3]
          : ''}
      </span>
    </div>
  );
}
