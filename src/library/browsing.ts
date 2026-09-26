import { readableText } from '../domain';
import type { Filters, Idea } from '../types';

export function previewOf(idea: Idea): string {
  const body = readableText(idea.body).trim();
  const lines = body.split('\n');
  if (
    idea.title?.trim() &&
    lines[0]?.trim().toLocaleLowerCase() === idea.title.trim().toLocaleLowerCase()
  )
    lines.shift();
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}
export function dateBoundary(value: string, nextDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.getTime();
}
export function dateInput(time: number | null): string {
  if (time === null) return '';
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export type DatePreset = 'any' | 'today' | 'week' | 'month' | 'range';
export function presetBounds(preset: DatePreset, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === 'month') start.setDate(1);
  return preset === 'any' || preset === 'range'
    ? { from: null, to: null }
    : { from: start.getTime(), to: end.getTime() };
}
export function isFiltered(filters: Filters) {
  return !!(
    filters.query ||
    filters.types.length ||
    filters.topics.length ||
    filters.noType ||
    filters.hasLinks ||
    filters.from !== null ||
    filters.to !== null ||
    filters.untagged
  );
}
export function timeGroup(time: number, now: number) {
  if (time >= presetBounds('today', now).from!) return 'Today';
  const yesterday = new Date(presetBounds('today', now).from!);
  yesterday.setDate(yesterday.getDate() - 1);
  if (time >= yesterday.getTime()) return 'Yesterday';
  if (time >= presetBounds('week', now).from!) return 'This week';
  if (time >= presetBounds('month', now).from!) return 'This month';
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(time);
}
export const fullDate = (time: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
