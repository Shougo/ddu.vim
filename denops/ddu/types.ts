export { BaseUi } from "./base/ui.ts";
export { BaseSource } from "./base/source.ts";
export { BaseFilter } from "./base/filter.ts";
export { BaseKind } from "./base/kind.ts";
export type { UiActions } from "./base/ui.ts";
import { Denops } from "./deps.ts";

export type DduExtType = "ui" | "source" | "filter" | "kind";

export type DduEvent = "close" | "cancel";

export type SourceName = string;

export type Context = {
  bufNr: number;
  done: boolean;
  input: string;
  maxItems: number;
  winId: number;
};

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
  actionOptions: Record<string, Partial<ActionOptions>>;
  filterOptions: Record<string, Partial<FilterOptions>>;
  filterParams: Record<string, Partial<Record<string, unknown>>>;
  input: string;
  kindOptions: Record<string, Partial<KindOptions>>;
  kindParams: Record<string, Partial<Record<string, unknown>>>;
  name: string;
  profile: boolean;
  push: boolean;
  refresh: boolean;
  resume: boolean;
  sourceOptions: Record<SourceName, Partial<SourceOptions>>;
  sourceParams: Record<SourceName, Partial<Record<string, unknown>>>;
  sources: UserSource[];
  sync: boolean;
  ui: string;
  uiOptions: Record<string, Partial<UiOptions>>;
  uiParams: Record<string, Partial<Record<string, unknown>>>;
  volatile: boolean;
};

export type UiOptions = {
  defaultAction: string;
};

export type SourceOptions = {
  actions: Record<string, string>;
  converters: string[];
  defaultAction: string;
  ignoreCase: boolean;
  matcherKey: string;
  matchers: string[];
  maxItems: number;
  path: string;
  sorters: string[];
};

export type FilterOptions = {
  // TODO: add options and remove placeholder
  placeholder?: unknown;
};

export type KindOptions = {
  actions: Record<string, string>;
  defaultAction: string;
};

export type ActionOptions = {
  quit: boolean;
};

export type ItemHighlight = {
  name: string;
  "hl_group": string;
  col: number;
  width: number;
};

export type Item<
  ActionData extends unknown = unknown,
> = {
  word: string;
  display?: string;
  action?: ActionData;
  highlights?: ItemHighlight[];
};

// For internal type
export type DduActionData = unknown;

export type DduItem =
  & Item<DduActionData>
  & {
    matcherKey: string;
    __sourceIndex: number;
    __sourceName: string;
    __level: number;
    __expanded: boolean;
  };

export type ActionArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  kindOptions: KindOptions;
  kindParams: Params;
  actionParams: unknown;
  items: DduItem[];
};

export type Actions<Params extends Record<string, unknown>> = Record<
  string,
  (args: ActionArguments<Params>) => Promise<ActionFlags>
>;

export enum ActionFlags {
  None = 0,
  RefreshItems = 1 << 0,
  Redraw = 1 << 1,
  Persist = 1 << 2,
}

export type TermPreviewer = {
  kind: "terminal";
  cmds: string[];
};

export type NoFilePreviewer = {
  kind: "nofile";
  contents: string[];
  syntax?: string;
} & PreviewerCommon;

export type BufferPreviewer = {
  kind: "buffer";
  expr?: number | string;
  path?: string;
} & PreviewerCommon;

type PreviewerCommon = {
  highlights?: ItemHighlight[];
  lineNr?: number;
};

export type Previewer =
  | TermPreviewer
  | BufferPreviewer
  | NoFilePreviewer
  | undefined;
