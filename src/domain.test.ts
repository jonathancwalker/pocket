import { describe, it, expect } from 'vitest';
import { parseLink, readableText, WriteQueue } from './domain';
describe('reference input', () => {
  it('keeps original URLs while normalizing identity without losing query or fragment', () => {
    const first = parseLink(' https://EXAMPLE.com:443/a?q=1#poem ');
    expect(first.url).toBe('https://EXAMPLE.com:443/a?q=1#poem');
    expect(first.key).toBe('https://example.com/a?q=1#poem');
    expect(first.key).not.toBe(parseLink('https://example.com/a?q=2#poem').key);
    expect(first.hostname).toBe('example.com');
  });
  it.each([
    'javascript:alert(1)',
    'file:///tmp/private',
    'not a link',
    'https://a.test https://b.test',
    'https://name:password@example.com',
  ])('rejects %s', (value) => expect(() => parseLink(value)).toThrow());
});
describe('writing text', () => {
  it('preserves poetry line breaks, indentation, blank paragraphs and emoji', () => {
    expect(
      readableText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '  first 🌱' },
              { type: 'hardBreak' },
              { type: 'text', text: 'second' },
            ],
          },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: 'third' }] },
        ],
      }),
    ).toBe('  first 🌱\nsecond\n\nthird');
  });
});
describe('serialized persistence', () => {
  it('waits for an unfinished save before applying the next mutation', async () => {
    const writes: string[] = [];
    const queue = new WriteQueue();
    let release: () => void = () => {};
    const first = queue.run(async () => {
      writes.push('started');
      await new Promise<void>((r) => {
        release = r;
      });
      writes.push('saved');
    });
    const second = queue.run(async () => {
      writes.push('archived');
    });
    await Promise.resolve();
    expect(writes).toEqual(['started']);
    release();
    await Promise.all([first, second]);
    expect(writes).toEqual(['started', 'saved', 'archived']);
  });
  it('reports a failed write and still allows an explicit retry', async () => {
    const queue = new WriteQueue();
    await expect(
      queue.run(async () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });
});
