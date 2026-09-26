import type { Reference, JsonNode } from './types';
export function parseLink(value: string): Reference {
  const url = value.trim();
  if (/\s/.test(url)) throw new Error('One web link at a time.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Paste a web link, starting with https://');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Paste a web link, starting with https://');
  return { id: crypto.randomUUID(), url, key: parsed.href, hostname: parsed.hostname };
}
export const errorText = (error: unknown) =>
  typeof error === 'string'
    ? error
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : 'Something went wrong. Your text is still here.';
export const readableText = (node: JsonNode): string =>
  node.type === 'text'
    ? node.text || ''
    : node.type === 'hardBreak'
      ? '\n'
      : (node.content || [])
          .map(readableText)
          .join(
            ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type)
              ? '\n'
              : '',
          );

/** A rejected write does not poison later retries; callers still receive its error. */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(write: () => Promise<T>): Promise<T> {
    const task = this.tail.then(write);
    this.tail = task.catch(() => undefined);
    return task;
  }
  async drain() {
    await this.tail;
  }
}
