export { BaseUi } from "./base/ui.ts";
export { BaseSource } from "./base/source.ts";
export { BaseFilter } from "./base/filter.ts";
export { BaseKind } from "./base/kind.ts";

export type SourceName = string;

export type Custom = {
  source: Record<SourceName, SourceOptions>;
  option: DduOptions;
};

export type Context = {
  // TODO: add options and remove placeholder
  placeholder?: unknown;
};

export type Source = {
  name: string;
  options?: SourceOptions;
  params?: Record<string, unknown>;
};

export type DduOptions = {
  filterOptions: Record<string, Partial<FilterOptions>>;
  filterParams: Record<string, Partial<Record<string, unknown>>>;
  kindOptions: Record<string, Partial<KindOptions>>;
  kindParams: Record<string, Partial<Record<string, unknown>>>;
  sourceOptions: Record<SourceName, Partial<SourceOptions>>;
  sourceParams: Record<SourceName, Partial<Record<string, unknown>>>;
  sources: Source[];
  uiOptions: Record<string, Partial<UiOptions>>;
  uiParams: Record<string, Partial<Record<string, unknown>>>;
};

export type UiOptions = {
  bufferName: string;
  input: string;
};

export type SourceOptions = {
  matcherKey: string;
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
  abbr?: string;
  menu?: string;
  action?: ActionData;
};

// For internal type
export type DduActionData = unknown;

export type DduItem =
  & Item<DduActionData>
  & {
    matcherKey: string;
  };
