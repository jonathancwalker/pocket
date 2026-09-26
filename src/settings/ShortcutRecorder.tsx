import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, onNative } from '../bridge';
import { errorText } from '../domain';
import { nativeStroke, recordStroke, shortcutKeys, type KeyStroke } from './shortcuts';

export default function ShortcutRecorder({
  value,
  onChange,
  onRecording,
}: {
  value: string;
  onChange: (value: string) => void;
  onRecording: (active: boolean) => void;
}) {
  const [recording, setRecording] = useState(false),
    [held, setHeld] = useState(''),
    [error, setError] = useState('');
  const active = useRef(false),
    button = useRef<HTMLButtonElement>(null),
    candidate = useRef<string | null>(null);
  const handler = useRef((_stroke: KeyStroke) => {});
  async function stop() {
    active.current = false;
    candidate.current = null;
    setRecording(false);
    onRecording(false);
    try {
      await api.recording(false);
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function start() {
    setError('');
    setHeld('');
    candidate.current = null;
    try {
      await api.recording(true);
      if (!document.hasFocus()) {
        await api.recording(false);
        return;
      }
      active.current = true;
      setRecording(true);
      onRecording(true);
      button.current?.focus();
    } catch (e) {
      setError(errorText(e));
    }
  }
  handler.current = (stroke) => {
    if (!active.current) return;
    if (stroke.code === 'Escape') {
      void stop();
      return;
    }
    if (candidate.current) {
      if (!stroke.metaKey && !stroke.ctrlKey && !stroke.altKey && !stroke.shiftKey) {
        onChange(candidate.current);
        void stop();
      }
      return;
    }
    const result = recordStroke(stroke);
    setHeld(result.value);
    setError(result.error);
    if (result.complete) {
      candidate.current = result.value;
    }
  };
  useEffect(() => {
    const off = onNative<{ code: number; flags: number; down: boolean }>('shortcut-key', (e) =>
      handler.current(nativeStroke(e)),
    );
    const blur = () => {
      if (active.current) void stop();
    };
    window.addEventListener('blur', blur);
    return () => {
      off();
      window.removeEventListener('blur', blur);
      active.current = false;
      void api.recording(false).catch(() => {});
    };
  }, []);
  const keys = shortcutKeys(recording ? held : value);
  return (
    <div className="shortcut-field">
      <div className={`shortcut-recorder ${recording ? 'recording' : ''}`}>
        <button
          ref={button}
          type="button"
          aria-label={recording ? 'Press your shortcut' : 'Record shortcut'}
          aria-pressed={recording}
          title="Click and press the shortcut you want to use"
          onClick={() => {
            if (!recording) void start();
          }}
          onKeyDown={(e) => {
            if (!active.current) return;
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat && !e.nativeEvent.isComposing) handler.current(e);
          }}
          onKeyUp={(e) => {
            if (active.current) {
              e.preventDefault();
              e.stopPropagation();
              handler.current({ ...e, code: '' });
            }
          }}
        >
          {keys.length ? (
            <span className="shortcut-keys">
              {keys.map((key, index) => (
                <kbd key={index}>{key}</kbd>
              ))}
            </span>
          ) : (
            <span className="recorder-prompt">Press your shortcut</span>
          )}
          <span className="recorder-indicator" aria-hidden="true" />
        </button>
        {recording && (
          <button
            type="button"
            className="cancel-recording icon-button"
            aria-label="Cancel shortcut recording"
            title="Cancel · Esc"
            onClick={() => void stop()}
          >
            <X size={15} />
          </button>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
