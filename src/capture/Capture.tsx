import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, BookOpen, Copy, ExternalLink, Link2, LoaderCircle, Trash2 } from 'lucide-react';
import { api, onNative } from '../bridge';
import { errorText, parseLink, WriteQueue } from '../domain';
import { type Draft, type Reference } from '../types';
import IconButton from '../components/IconButton';
import { LinkPaste, nextPrompt } from '../interaction';

export default function Capture() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<'editing' | 'saving' | 'tucking' | 'saved'>('editing');
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkMode, setLinkMode] = useState(false);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [pendingLinks, setPendingLinks] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [shake, setShake] = useState(0);
  const [shortcut, setShortcut] = useState('⌘ ⇧ Space');
  const [placeholder, setPlaceholder] = useState('Share away');
  const pasteSequence = useRef(new LinkPaste()),
    pendingLibrary = useRef(false);
  const draftRef = useRef<Draft | null>(null),
    savedSequence = useRef(0),
    queue = useRef(new WriteQueue());
  const input = useRef<HTMLTextAreaElement>(null),
    pasteInput = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLDivElement>(null),
    scene = useRef<HTMLDivElement>(null);
  const caret = useRef({ start: 0, end: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false),
    handoff = useRef(false),
    sequenceAtShow = useRef(0);
  const completeSave = useRef<(() => void) | null>(null);
  const actions = useRef({
    flush: async () => {},
    dismiss: async (_onlyIfBlurred = false) => {},
    show: async () => {},
    openLibrary: async () => {},
  });
  function assign(d: Draft) {
    draftRef.current = d;
    setDraft(d);
  }
  function focusEditor() {
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret.current.start, caret.current.end);
    });
  }
  function changed(update: Partial<Draft>) {
    if (!draftRef.current || busy.current) return;
    assign({ ...draftRef.current, ...update, sequence: draftRef.current.sequence + 1 });
    setError('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), 300);
  }
  async function flush() {
    clearTimeout(timer.current);
    const current = draftRef.current;
    if (!current) {
      if (busy.current) {
        await queue.current.drain();
        return;
      }
      throw new Error('Your draft has not loaded yet.');
    }
    try {
      await queue.current.run(async () => {
        if (current.sequence <= savedSequence.current) return;
        const saved = await api.saveDraft(current);
        savedSequence.current = Math.max(savedSequence.current, saved.sequence);
        if (draftRef.current?.id === saved.id)
          setPendingLinks(
            new Set(
              draftRef.current.links
                .filter((l) => !saved.links.some((s) => s.id === l.id))
                .map((l) => l.id),
            ),
          );
      });
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  }
  async function loadDraft(synchronous = false) {
    const d = await api.draft();
    const reset = () => {
      assign(d);
      savedSequence.current = d.sequence;
      setPendingLinks(new Set());
      setLinkMode(false);
      setSelectedLink(null);
      setOverflow(false);
      setLinkError('');
      setStatus('editing');
      setError('');
      caret.current = { start: d.text.length, end: d.text.length };
    };
    if (synchronous) flushSync(reset);
    else reset();
    return d;
  }
  async function dismiss(onlyIfBlurred = false) {
    if (busy.current || handoff.current) return;
    const generation = sequenceAtShow.current;
    try {
      await flush();
      if (generation !== sequenceAtShow.current) return;
      // A queued blur from the previous invocation must not hide a refocused window.
      await api.action(onlyIfBlurred ? 'dismiss-blurred' : 'dismiss');
      setLinkMode(false);
      setSelectedLink(null);
      setOverflow(false);
    } catch {
      /* keep the draft available */
    }
  }
  async function show() {
    sequenceAtShow.current++;
    setPlaceholder((previous) => nextPrompt(previous));
    pasteSequence.current.reset();
    if (busy.current) {
      completeSave.current?.();
      return;
    }
    clearTimeout(closeTimer.current);
    if (!draftRef.current) {
      try {
        await loadDraft();
      } catch (e) {
        setError(errorText(e));
        return;
      }
    }
    setStatus('editing');
    focusEditor();
  }
  actions.current = { flush, dismiss, show, openLibrary };
  useEffect(() => {
    let live = true;
    const unsubscribers = [
      onNative('capture-shown', () => void actions.current.show()),
      onNative('capture-open-library', () => void actions.current.openLibrary()),
      onNative('capture-blurred', () => void actions.current.dismiss(true)),
      onNative('request-close', () => void actions.current.dismiss()),
      onNative<{ token: number }>('prepare-quit', ({ token }) => {
        void actions.current
          .flush()
          .then(() => api.quitAck(token, true))
          .catch(() => api.quitAck(token, false));
      }),
    ];
    void loadDraft()
      .then(() => {
        if (live) input.current?.focus();
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => {
        if (live) void api.ready().catch((e) => setError(errorText(e)));
      });
    void api
      .settings()
      .then((s) =>
        setShortcut(
          s.shortcut.replace('CommandOrControl', '⌘').replace('Shift', '⇧').replaceAll('+', ' '),
        ),
      )
      .catch(() => {});
    return () => {
      live = false;
      unsubscribers.forEach((fn) => fn());
      clearTimeout(timer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = '0px';
    const textHeight = Math.max(34, Math.min(field.scrollHeight, 272));
    field.style.height = `${textHeight}px`;
  }, [draft?.text, draft?.id]);
  useLayoutEffect(() => {
    const card = panel.current;
    if (!card) return;
    let previous = 0;
    const resize = () => {
      if (busy.current) return;
      const desired = Math.ceil(card.getBoundingClientRect().height) + 24;
      if (desired === previous) return;
      previous = desired;
      void api.action('resize', desired).catch((e) => setError(errorText(e)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (linkMode) pasteInput.current?.focus();
  }, [linkMode]);
  async function save() {
    const d = draftRef.current;
    if (!d || busy.current || (!d.text.trim() && !d.links.length)) return;
    busy.current = true;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    flushSync(() => {
      setLinkMode(false);
      setSelectedLink(null);
      setOverflow(false);
      setStatus('saving');
      setError('');
    });
    clearTimeout(timer.current);
    const showGeneration = sequenceAtShow.current;
    try {
      await flush();
      const saved = await queue.current.run(() => api.commit(d));
      void api.generateCaptureTitle(saved.id).catch(() => {});
      draftRef.current = null;
      const paper = panel.current!;
      const height = paper.offsetHeight;
      scene.current!.style.setProperty('--paper-fold-x', String(80 / paper.offsetWidth));
      scene.current!.style.setProperty('--paper-fold-y', String(Math.min(55 / height, 0.8)));
      scene.current!.style.setProperty('--paper-drop', `${height / 2 + 59}px`);
      // Leave room for the pocket before starting the motion. The paper keeps
      // its position; the transparent native window only extends downwards.
      await api.action('resize', height + 24 + 118);
      if (!reduced) {
        // Start the tuck only after commit and let the actual rendered motion
        // finish before showing the check, even when a frame is delayed.
        flushSync(() => setStatus('tucking'));
        const motions = scene
          .current!.getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation instanceof CSSAnimation && animation.animationName.startsWith('tuck-'),
          );
        completeSave.current = () => motions.forEach((animation) => animation.finish());
        if (pendingLibrary.current || showGeneration !== sequenceAtShow.current)
          completeSave.current();
        await Promise.all(motions.map((animation) => animation.finished.catch(() => {})));
        completeSave.current = null;
      }
      setStatus('saved');
      setAnnouncement('Idea saved on this device.');
      const complete = () => {
        completeSave.current = null;
        clearTimeout(closeTimer.current);
        void (async () => {
          // AppKit fades the native window, then hides at zero opacity.
          // Reset only after that acknowledgment; shortcut requests during the
          // fade are queued natively until the fresh field is ready.
          await api.fadeCapture(reduced);
          await loadDraft(true);
          await api.action('resize', Math.ceil(panel.current!.getBoundingClientRect().height) + 24);
          const library = pendingLibrary.current;
          pendingLibrary.current = false;
          handoff.current = true;
          busy.current = false;
          await api.finishCapture(showGeneration !== sequenceAtShow.current, library);
          handoff.current = false;
        })().catch(async (e) => {
          busy.current = false;
          handoff.current = false;
          setError(errorText(e));
          setStatus('editing');
          await api.finishCapture(true, false).catch(() => {});
        });
      };
      completeSave.current = complete;
      // The check draws for 180 ms, then holds for a full second. An explicit
      // request for capture or the library can skip the decorative hold.
      if (pendingLibrary.current || showGeneration !== sequenceAtShow.current) complete();
      else closeTimer.current = setTimeout(complete, reduced ? 1000 : 1180);
    } catch (e) {
      completeSave.current = null;
      busy.current = false;
      setStatus('editing');
      setError(errorText(e));
      focusEditor();
    }
  }
  async function addLink(raw: string, automatic = false) {
    if (busy.current || !draftRef.current) return;
    try {
      const link = parseLink(raw);
      const duplicate = draftRef.current.links.find((l) => l.key === link.key);
      if (duplicate) {
        setLinkMode(false);
        setSelectedLink(automatic ? null : duplicate.id);
        setLinkError('');
        setAnnouncement('That link is already attached.');
        return;
      }
      setLinkError('');
      setPendingLinks((previous) => new Set(previous).add(link.id));
      changed({ links: [...draftRef.current.links, link] });
      await flush();
      setLinkMode(false);
      setAnnouncement('Link added to draft.');
      focusEditor();
    } catch (e) {
      if (automatic) setError(errorText(e));
      else {
        setLinkError(errorText(e));
        setShake((v) => v + 1);
        pasteInput.current?.focus();
      }
    }
  }
  async function removeLink(link: Reference) {
    if (!draftRef.current || busy.current) return;
    changed({ links: draftRef.current.links.filter((l) => l.id !== link.id) });
    try {
      await flush();
      setSelectedLink(null);
      setAnnouncement('Link removed.');
      focusEditor();
    } catch {
      /* retained error */
    }
  }
  async function openLibrary() {
    if (busy.current) {
      pendingLibrary.current = true;
      completeSave.current?.();
      return;
    }
    handoff.current = true;
    try {
      await flush();
      await api.action('library');
    } catch (e) {
      setError(errorText(e));
    } finally {
      handoff.current = false;
    }
  }
  const inspected = draft?.links.find((l) => l.id === selectedLink);
  return (
    <main
      className={`capture-shell ${status === 'saved' ? 'capture-complete' : ''}`}
      data-stage={status}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (
          !['Meta', 'Control', 'Shift', 'Alt'].includes(event.key) &&
          !((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v')
        )
          pasteSequence.current.reset();
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void save();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (linkMode || selectedLink || overflow) {
            setLinkMode(false);
            setSelectedLink(null);
            setOverflow(false);
            focusEditor();
          } else void dismiss();
        }
      }}
    >
      <div ref={scene} className="capture-scene">
        <div ref={panel} className="capture-card">
          <div className="capture-paper">
            <span className="paper-rules" aria-hidden="true" />
            <span className="paper-margin" aria-hidden="true" />
            <span className="paper-corner" aria-hidden="true" />
            <div
              className="capture-content"
              aria-hidden={status === 'tucking' || status === 'saved'}
            >
              <div className="capture-line">
                <textarea
                  ref={input}
                  aria-label="Your idea"
                  placeholder={placeholder}
                  rows={1}
                  value={draft?.text ?? ''}
                  disabled={!draft || status !== 'editing'}
                  spellCheck
                  onChange={(e) => {
                    pasteSequence.current.reset();
                    changed({ text: e.target.value });
                  }}
                  onMouseDown={() => pasteSequence.current.reset()}
                  onPaste={(e) => {
                    if (busy.current) {
                      e.preventDefault();
                      return;
                    }
                    const raw = e.clipboardData.getData('text/plain');
                    const link = pasteSequence.current.read(raw);
                    if (link) {
                      e.preventDefault();
                      caret.current = {
                        start: e.currentTarget.selectionStart,
                        end: e.currentTarget.selectionEnd,
                      };
                      void addLink(raw, true);
                    }
                  }}
                  onSelect={(e) => {
                    caret.current = {
                      start: e.currentTarget.selectionStart,
                      end: e.currentTarget.selectionEnd,
                    };
                  }}
                />
                <div className="capture-actions">
                  <IconButton
                    label="Attach a link"
                    disabled={status !== 'editing'}
                    onClick={() => {
                      setLinkMode((v) => !v);
                      setSelectedLink(null);
                      setOverflow(false);
                    }}
                  >
                    <Link2 size={18} strokeWidth={1.6} />
                  </IconButton>
                  <IconButton
                    label="Open idea library"
                    disabled={status !== 'editing'}
                    onClick={() => void openLibrary()}
                  >
                    <BookOpen size={19} strokeWidth={1.6} />
                  </IconButton>
                  <button
                    className="capture-save"
                    aria-label="Save idea · ⌘Enter"
                    title="Save idea · ⌘Enter"
                    disabled={
                      !draft || (!draft.text.trim() && !draft.links.length) || status !== 'editing'
                    }
                    onClick={() => void save()}
                  >
                    {status === 'saving' ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <ArrowDown size={19} strokeWidth={1.6} />
                    )}
                  </button>
                </div>
              </div>
              {!!draft?.links.length && (
                <div className="link-cluster" aria-label="Attached links">
                  {draft.links.slice(0, 5).map((link, index) => (
                    <button
                      key={link.id}
                      disabled={status !== 'editing'}
                      className={`link-slot filled ${pendingLinks.has(link.id) ? 'pending' : ''}`}
                      aria-label={`Inspect reference ${index + 1}: ${link.hostname}`}
                      title={link.hostname}
                      onClick={() => {
                        setSelectedLink(selectedLink === link.id ? null : link.id);
                        setLinkMode(false);
                        setOverflow(false);
                      }}
                    >
                      <span />
                    </button>
                  ))}
                  {draft.links.length > 5 && (
                    <button
                      className="link-overflow"
                      title="See all references"
                      onClick={() => {
                        setOverflow((v) => !v);
                        setSelectedLink(null);
                        setLinkMode(false);
                      }}
                    >
                      +{draft.links.length - 5}
                    </button>
                  )}
                </div>
              )}
              {linkMode && (
                <div
                  key={shake}
                  className={`capture-popover paste-popover ${linkError ? 'shake' : ''}`}
                >
                  <div className="link-input">
                    <Link2 size={16} />
                    <input
                      id="paste-link"
                      ref={pasteInput}
                      autoFocus
                      aria-label="Paste a reference link"
                      placeholder="Paste a link"
                      onPaste={(e) => {
                        e.preventDefault();
                        void addLink(e.clipboardData.getData('text/plain'));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void addLink(e.currentTarget.value);
                        }
                      }}
                    />
                  </div>
                  {linkError && (
                    <p role="alert" className="field-error">
                      {linkError}
                    </p>
                  )}
                </div>
              )}
              {inspected && (
                <div className="capture-popover reference-popover">
                  <div className="reference-heading">
                    <Link2 size={16} />
                    <strong>{inspected.hostname}</strong>
                  </div>
                  <p className="reference-url">{inspected.url}</p>
                  <div className="popover-actions">
                    <button
                      onClick={() =>
                        void api.openLink(inspected.url).catch((e) => setError(errorText(e)))
                      }
                    >
                      <ExternalLink size={14} />
                      Open
                    </button>
                    <button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(inspected.url)
                          .then(() => setAnnouncement('Link copied.'))
                          .catch((e) => setError(errorText(e)))
                      }
                    >
                      <Copy size={14} />
                      Copy
                    </button>
                    <button onClick={() => void removeLink(inspected)}>
                      <Trash2 size={14} />
                      Remove
                    </button>
                  </div>
                </div>
              )}
              {overflow && (
                <div className="capture-popover overflow-popover">
                  {draft?.links.map((link) => (
                    <button
                      key={link.id}
                      onClick={() => {
                        setSelectedLink(link.id);
                        setOverflow(false);
                      }}
                    >
                      <Link2 size={14} />
                      {link.hostname}
                    </button>
                  ))}
                </div>
              )}
              {error && (
                <div className="capture-error" role="alert">
                  {error}
                  <button
                    onClick={() =>
                      void (draftRef.current ? flush() : loadDraft())
                        .then(() => setError(''))
                        .catch((e) => setError(errorText(e)))
                    }
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {(status === 'tucking' || status === 'saved') && (
          <div
            className={`capture-confirmation ${status}`}
            role="status"
            aria-label={status === 'saved' ? 'Idea saved' : 'Saving idea'}
          >
            <div className="tuck-pocket-back" aria-hidden="true" />
            <div className="tuck-pocket" aria-hidden="true">
              {status === 'saved' && (
                <svg className="confirmation-check" viewBox="0 0 40 40">
                  <path d="m11 20 6 6 13-13" />
                </svg>
              )}
            </div>
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <span className="sr-only">Capture shortcut: {shortcut}</span>
    </main>
  );
}
