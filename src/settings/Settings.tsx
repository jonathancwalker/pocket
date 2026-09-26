import { useEffect, useState } from 'react';
import { Download, X, LoaderCircle } from 'lucide-react';
import { api } from '../bridge';
import { errorText } from '../domain';
import type { Settings as Preferences } from '../types';
import IconButton from '../components/IconButton';
import ShortcutRecorder from './ShortcutRecorder';
export default function Settings({
  onClose,
  beforeExport,
}: {
  onClose: () => void;
  beforeExport: () => Promise<void>;
}) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.systemInfo>> | null>(null),
    [settings, setSettings] = useState<Preferences | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false),
    [titleKey, setTitleKey] = useState(''),
    [hasTitleKey, setHasTitleKey] = useState(false);
  useEffect(() => {
    void Promise.all([api.systemInfo(), api.titleKeyStatus()])
      .then(([i, key]) => {
        setInfo(i);
        setSettings(i.settings);
        setHasTitleKey(key.hasKey);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      setNotice('Saved');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveTitleKey() {
    if (!titleKey.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.saveTitleKey(titleKey);
      setTitleKey('');
      setHasTitleKey(true);
      setNotice('API key saved');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function clearTitleKey() {
    setBusy(true);
    setError('');
    try {
      await api.clearTitleKey();
      setHasTitleKey(false);
      setTitleKey('');
      setNotice('API key removed');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy && !recording) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <IconButton label="Close settings" disabled={busy} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {settings && (
          <>
            <div className="settings-section">
              <div className="setting-label">Keyboard shortcut</div>
              <ShortcutRecorder
                value={settings.shortcut}
                onChange={(shortcut) => {
                  setSettings({ ...settings, shortcut });
                  setNotice('');
                }}
                onRecording={setRecording}
              />
              <label className="toggle-row">
                <span>
                  <strong>Double-tap Command</strong>
                  <small>Requires macOS Accessibility permission.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.doubleCommand}
                  onChange={(e) => setSettings({ ...settings, doubleCommand: e.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Open at login</strong>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.launchAtLogin}
                  onChange={(e) => setSettings({ ...settings, launchAtLogin: e.target.checked })}
                />
              </label>
            </div>
            <div className="settings-section">
              <div className="setting-label">Automatic titles</div>
              {hasTitleKey ? (
                <div className="kept-api-key" role="status">
                  <div>
                    <strong>OpenAI API key</strong>
                    <small>Saved locally on this Mac</small>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void clearTitleKey()}
                  >
                    Remove key
                  </button>
                </div>
              ) : (
                <>
                  <label className="setting-field">
                    <span>OpenAI API key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={titleKey}
                      placeholder="Paste your API key"
                      onChange={(e) => {
                        setTitleKey(e.target.value);
                        setNotice('');
                      }}
                    />
                    <small>Used only to title new captures. Saved locally on this Mac.</small>
                  </label>
                  <button
                    type="button"
                    className="primary-button save-api-key"
                    disabled={busy || !titleKey.trim()}
                    onClick={() => void saveTitleKey()}
                  >
                    Save API key
                  </button>
                </>
              )}
            </div>
            <div className="settings-section">
              <label className="toggle-row">
                <span>
                  <strong>Ideas in the pocket</strong>
                  <small>Pull a random idea. Turn off for little keepsakes.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.pocketIdeas}
                  onChange={(e) => {
                    setSettings({ ...settings, pocketIdeas: e.target.checked });
                    setNotice('');
                  }}
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void beforeExport()
                    .then(() => api.export())
                    .then((path) => {
                      if (path) setNotice(`Backup saved to ${path}`);
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <Download size={16} />
                Export library
              </button>
            </div>
            {info?.shortcutError && <p className="field-error">{info.shortcutError}</p>}
            <footer>
              <button
                className="primary-button"
                disabled={busy || recording}
                onClick={() => void save()}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : null}Save
              </button>
            </footer>
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success-notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
