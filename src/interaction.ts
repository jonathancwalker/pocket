import { parseLink } from './domain';

export const prompts = [
  'Share away',
  'What’s new?',
  'Log it down',
  'A little what if?',
  'Keep that thought',
  'What’s on your mind?',
  'Start anywhere',
  'Something to remember?',
];
export function nextPrompt(previous: string, random = Math.random()) {
  const choices = prompts.filter((p) => p !== previous);
  return choices[Math.min(choices.length - 1, Math.floor(random * choices.length))];
}

/** Only a complete URL is diverted. Mixed prose remains exactly as pasted. */
export class LinkPaste {
  private last: { key: string; at: number } | null = null;
  reset() {
    this.last = null;
  }
  read(raw: string, at = performance.now()) {
    try {
      const link = parseLink(raw);
      if (this.last?.key === link.key && at - this.last.at <= 3000) {
        this.reset();
        return null;
      }
      this.last = { key: link.key, at };
      return link;
    } catch {
      this.reset();
      return null;
    }
  }
}

export function relativeAge(createdAt: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (!minutes) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 43200) return `${Math.floor(minutes / 1440)}d ago`;
  if (minutes < 525600) return `${Math.floor(minutes / 43200)}mo ago`;
  return `${Math.floor(minutes / 525600)}y ago`;
}
