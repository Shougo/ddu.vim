export { BaseUi } from "./base/ui.ts";
export { BaseSource } from "./base/source.ts";
export { BaseFilter } from "./base/filter.ts";
export { BaseKind } from "./base/kind.ts";

export type DduExtType = "ui" | "source" | "filter" | "kind";

export type SourceName = string;

export type Custom = {
  source: Record<SourceName, SourceOptions>;
  option: DduOptions;
};

export type UserSource = {
  name: string;
  options?: SourceOptions;
  params?: Record<string, unknown>;
};

export type DduOptions = {
  filterOptions: Record<string, Partial<FilterOptions>>;
  filterParams: Record<string, Partial<Record<string, unknown>>>;
  input: string;
  kindOptions: Record<string, Partial<KindOptions>>;
  kindParams: Record<string, Partial<Record<string, unknown>>>;
  name: string;
  sourceOptions: Record<SourceName, Partial<SourceOptions>>;
  sourceParams: Record<SourceName, Partial<Record<string, unknown>>>;
  sources: UserSource[];
  ui: string;
  uiOptions: Record<string, Partial<UiOptions>>;
  uiParams: Record<string, Partial<Record<string, unknown>>>;
};

export type UiOptions = {
  defaultAction: string;
};

export type SourceOptions = {
  converters: string[];
  matcherKey: string;
  matchers: string[];
  sorters: string[];
};

export type FilterOptions = {
  // TODO: add options and remove placeholder
  placeholder?: unknown;
};

export type KindOptions = {
  defaultAction: string;
};

export type Item<
  ActionData extends unknown = unknown,
> = {
  word: string;
  display?: string;
  action?: ActionData;
};

// For internal type
export type DduActionData = unknown;

export type DduItem =
  & Item<DduActionData>
  & {
    matcherKey: string;
    __sourceName: string;
  };

export enum ActionFlags {
  None = 0,
  RefreshItems = 1 << 0,
  Redraw = 1 << 1,
}
