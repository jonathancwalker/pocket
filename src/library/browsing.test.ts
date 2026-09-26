import { describe, expect, it } from 'vitest';
import { dateBoundary, dateInput, presetBounds, previewOf, timeGroup } from './browsing';
import { emptyBody, type Idea } from '../types';
const note = (title: string | null, captureText: string, text = '') =>
  ({
    title,
    captureText,
    body: text
      ? {
          type: 'doc',
          content: text
            .split('\n')
            .map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
        }
      : emptyBody(),
  }) as Idea;
describe('previews from existing writing', () => {
  it('uses expanded writing, removes a repeated title, and never invents a subtitle', () => {
    expect(previewOf(note('Sunday', 'old capture', 'Sunday\nA slow morning\n\nwith coffee'))).toBe(
      'A slow morning with coffee',
    );
    expect(previewOf(note(null, '  a fragment\n   without a title'))).toBe(
      'a fragment without a title',
    );
    expect(previewOf(note('Just a title', ''))).toBe('');
    expect(previewOf(note('Sunday', 'Sunday'))).toBe('');
  });
  it('retains ordinary text that happens to begin with the title', () => {
    expect(previewOf(note('Rain', 'Rain on the windows'))).toBe('Rain on the windows');
  });
});
describe('local calendar filters', () => {
  it('uses calendar midnight and an exclusive next day for an inclusive through date', () => {
    expect(dateBoundary('2026-03-08')).toBe(new Date(2026, 2, 8).getTime());
    expect(dateBoundary('2026-03-08', true)).toBe(new Date(2026, 2, 9).getTime());
    expect(dateInput(dateBoundary('2026-09-20'))).toBe('2026-09-20');
    expect(dateBoundary('2026-02-31')).toBeNull();
    expect(dateBoundary('')).toBeNull();
  });
  it('starts weeks on Monday and keeps the full current day', () => {
    const now = new Date(2026, 8, 20, 16, 20).getTime();
    expect(presetBounds('week', now)).toEqual({
      from: new Date(2026, 8, 14).getTime(),
      to: new Date(2026, 8, 21).getTime(),
    });
    expect(presetBounds('month', now).from).toBe(new Date(2026, 8, 1).getTime());
    expect(timeGroup(new Date(2026, 8, 19, 23).getTime(), now)).toBe('Yesterday');
  });
});
