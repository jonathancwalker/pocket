export type JsonNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: JsonNode[];
};
export type Reference = { id: string; url: string; key: string; hostname: string };
export type Draft = {
  id: string;
  text: string;
  links: Reference[];
  phrase: number;
  sequence: number;
  updatedAt: number;
};
export type Tag = { id: string; axis: 'type' | 'topic'; name: string; color: string | null };
export type Idea = {
  id: string;
  captureText: string;
  title: string | null;
  body: JsonNode;
  bodySchemaVersion: number;
  createdAt: number;
  contentUpdatedAt: number;
  updatedAt: number;
  starredAt: number | null;
  archivedAt: number | null;
  revision: number;
  links: Reference[];
  tags: Tag[];
};
export type IdeaPage = {
  ideas: Idea[];
  total: number;
  active: number;
  starred: number;
  archived: number;
};
export type Filters = {
  view: 'active' | 'starred' | 'archive';
  query: string;
  types: string[];
  topics: string[];
  untagged: boolean;
  noType: boolean;
  hasLinks: boolean;
  sort: 'newest' | 'oldest' | 'edited';
  from: number | null;
  to: number | null;
  offset: number;
  limit: number;
};
export type Settings = {
  shortcut: string;
  doubleCommand: boolean;
  launchAtLogin: boolean;
  onboardingDone: boolean;
  pocketIdeas: boolean;
};
export const emptyBody = (): JsonNode => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export const defaultFilters: Filters = {
  view: 'active',
  query: '',
  types: [],
  topics: [],
  untagged: false,
  noType: false,
  hasLinks: false,
  sort: 'newest',
  from: null,
  to: null,
  offset: 0,
  limit: 12,
};
export const titleOf = (idea: Idea) => idea.title?.trim() || 'Untitled';
