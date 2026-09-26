import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Draft, Filters, Idea, IdeaPage, Settings, Tag } from './types';
export const native = isTauri();
export const call = <T>(operation: string, input: unknown = null): Promise<T> =>
  invoke('storage', { operation, input });
export const api = {
  draft: () => call<Draft>('get_draft'),
  saveDraft: (draft: Draft) => call<Draft>('save_draft', draft),
  commit: (draft: Draft) => call<Idea>('commit_capture', draft),
  discard: (id: string) => call<void>('discard_draft', { id }),
  list: (filters: Filters) => call<IdeaPage>('list_ideas', filters),
  idea: (id: string) => call<Idea>('get_idea', { id }),
  randomIdea: (exclude: string | null) => call<Idea | null>('random_idea', { exclude }),
  tags: () => call<Tag[]>('list_tags'),
  settings: () => call<Settings>('get_settings'),
  content: (idea: Idea) =>
    call<Idea>('update_content', {
      id: idea.id,
      revision: idea.revision,
      title: idea.title,
      captureText: idea.captureText,
      body: idea.body,
      bodySchemaVersion: idea.bodySchemaVersion,
    }),
  action: (action: string, height?: number) =>
    invoke<void>('window_action', { action, height: height ?? null }),
  ready: () => invoke<void>('window_ready'),
  recording: (enabled: boolean) => invoke<void>('shortcut_recording', { enabled }),
  fadeCapture: (reducedMotion: boolean) => invoke<void>('capture_fade', { reducedMotion }),
  finishCapture: (reopen: boolean, library: boolean) =>
    invoke<void>('capture_finished', { reopen, library }),
  openLink: (url: string) => invoke<void>('open_reference', { url }),
  quitAck: (token: number, saved: boolean) => invoke<void>('quit_ack', { token, saved }),
  systemInfo: () =>
    invoke<{
      settings: Settings;
      dataPath: string;
      shortcutError: string | null;
      development: boolean;
      titlePrompt: string;
      titleModel: string;
      titleInputLimit: number;
    }>('system_info'),
  saveSettings: (settings: Settings) => invoke<Settings>('update_settings', { settings }),
  export: () => invoke<string | null>('export_library'),
  titleKeyStatus: () => invoke<{ hasKey: boolean }>('title_key_status'),
  saveTitleKey: (key: string) => invoke<void>('save_title_key', { key }),
  clearTitleKey: () => invoke<void>('clear_title_key'),
  generateCaptureTitle: (id: string) => invoke<Idea>('generate_capture_title', { id }),
};
export function onNative<T>(name: string, callback: (payload: T) => void): () => void {
  let cleanup: UnlistenFn | undefined,
    cancelled = false;
  void listen<T>(name, (event) => callback(event.payload)).then((fn) => {
    if (cancelled) fn();
    else cleanup = fn;
  });
  return () => {
    cancelled = true;
    cleanup?.();
  };
}
