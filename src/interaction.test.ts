import { describe, it, expect } from 'vitest';
import { LinkPaste, nextPrompt, prompts, relativeAge } from './interaction';
import { recordStroke, shortcutKeys, nativeStroke } from './settings/shortcuts';

describe('capture paste intent', () => {
  it('attaches a URL first and allows the immediate second paste as text', () => {
    const sequence = new LinkPaste();
    expect(sequence.read('https://example.com/a', 0)?.hostname).toBe('example.com');
    expect(sequence.read('https://example.com/a', 900)).toBeNull();
    expect(sequence.read('https://example.com/a', 1200)?.hostname).toBe('example.com');
  });
  it('does not divert mixed prose, invalid URLs, or reset-independent pastes', () => {
    const sequence = new LinkPaste();
    expect(sequence.read('Read https://example.com later', 0)).toBeNull();
    expect(sequence.read('javascript:alert(1)', 0)).toBeNull();
    expect(sequence.read('https://a.test', 0)).not.toBeNull();
    expect(sequence.read('https://a.test', 3001)).not.toBeNull();
    sequence.reset();
    expect(sequence.read('https://a.test', 3002)).not.toBeNull();
  });
});
describe('shortcuts', () => {
  it('records actual modifiers and a physical key, displaying keycaps', () => {
    const chord = recordStroke(nativeStroke({ code: 40, flags: 12, down: true }));
    expect(chord).toEqual({ value: 'Shift+Command+KeyK', complete: true, error: '' });
    expect(shortcutKeys(chord.value)).toEqual(['⇧', '⌘', 'K']);
  });
  it('shows partial modifiers and rejects bare keys or shift-only bindings', () => {
    expect(recordStroke(nativeStroke({ code: 55, flags: 8, down: false }))).toEqual({
      value: 'Command',
      complete: false,
      error: '',
    });
    expect(recordStroke(nativeStroke({ code: 45, flags: 0, down: true })).complete).toBe(false);
    expect(recordStroke(nativeStroke({ code: 45, flags: 4, down: true })).complete).toBe(false);
    expect(recordStroke(nativeStroke({ code: 49, flags: 9, down: true })).value).toBe(
      'Control+Command+Space',
    );
  });
});
it('changes the prompt without immediately repeating it', () => {
  for (const prompt of prompts)
    for (const random of [0, 0.5, 0.999]) expect(nextPrompt(prompt, random)).not.toBe(prompt);
});
it('gives compact relative times including future-clock tolerance', () => {
  expect(relativeAge(60000, 0)).toBe('now');
  expect(relativeAge(0, 60000)).toBe('1m ago');
  expect(relativeAge(0, 7200000)).toBe('2h ago');
  expect(relativeAge(0, 86400000)).toBe('1d ago');
});
