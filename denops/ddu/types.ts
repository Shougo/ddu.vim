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
  // TODO: add options and remove placeholder
  placeholder: void;
};

export type SourceOptions = {
  // TODO: add options and remove placeholder
  placeholder: void;
};

export type FilterOptions = {
  // TODO: add options and remove placeholder
  placeholder: void;
};

export type Candidate<
  UserData extends unknown = unknown,
> = {
  word: string;
  abbr?: string;
  menu?: string;
  "user_data"?: UserData;
};

// For internal type
export type DduUserData = unknown;

export type DduCandidate =
  & Candidate<DduUserData>
  & {
    // TODO: remove placeholder
    placeholder: void;
  };
