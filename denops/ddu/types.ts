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
  placeholder: void;
};

export type DduOptions = {
  // TODO: add options and remove placeholder
  placeholder: void;
};

export type UiOptions = {
  bufName: string;
};

export type SourceOptions = {
  // TODO: add options and remove placeholder
  placeholder: void;
};

export type FilterOptions = {
  // TODO: add options and remove placeholder
  placeholder: void;
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
