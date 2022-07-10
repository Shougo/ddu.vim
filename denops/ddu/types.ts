export { BaseUi } from "./base/ui.ts";
export { BaseSource } from "./base/source.ts";
export { BaseFilter } from "./base/filter.ts";
export { BaseKind } from "./base/kind.ts";
export { BaseColumn } from "./base/column.ts";
export type { UiActions } from "./base/ui.ts";
import { Denops } from "./deps.ts";

export type DduExtType = "ui" | "source" | "filter" | "kind" | "column";

export type DduEvent = "close" | "cancel";

export type SourceName = string;

export type Context = {
  bufNr: number;
  done: boolean;
  input: string;
  maxItems: number;
  path: string;
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

export type SourceInfo = {
  name: string;
  index: number;
  path: string;
};

export type DduOptions = {
  actionOptions: Record<string, Partial<ActionOptions>>;
  columnOptions: Record<string, Partial<ColumnOptions>>;
  columnParams: Record<string, Partial<Record<string, unknown>>>;
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
  toggle: boolean;
};

export type SourceOptions = {
  actions: Record<string, string>;
  columns: string[];
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

export type ColumnOptions = {
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

export type ItemStatus = {
  size?: number;
  time?: number;
};

export type Item<
  ActionData extends unknown = unknown,
> = {
  word: string;
  display?: string;
  action?: ActionData;
  highlights?: ItemHighlight[];
  status?: ItemStatus;
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
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  kindOptions: KindOptions;
  kindParams: Params;
  actionParams: unknown;
  items: DduItem[];
  clipboard: Clipboard;
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

/**
 * Information of preview window
 */
export type PreviewContext = {
  row: number;
  col: number;
  width: number;
  height: number;
  isFloating: boolean;
  isVertical: boolean;
};

export type PreviewHighlight = ItemHighlight & {
  row: number;
};

/**
 * Preview type which uses Vim/Neovim's terminal feature
 */
export type TerminalPreviewer = {
  kind: "terminal";

  /**
   * Commands passed to `termopen()` or `term_start()` to render the preview
   */
  cmds: string[];
};

/**
 * Preview type which shows the contents specified by the `contents` property
 */
export type NoFilePreviewer = {
  kind: "nofile";

  /**
   * Contents to be shown in the preview buffer
   */
  contents: string[];
} & PreviewerCommon;

/**
 * Preview type which shows the contents of files or existing buffers
 */
export type BufferPreviewer = {
  kind: "buffer";

  /**
   * Buffer expression, which is the same as the arguments of `bufname()`
   */
  expr?: number | string;

  /**
   * Path of file to preview
   */
  path?: string;
} & PreviewerCommon;

type PreviewerCommon = {
  /**
   * Highlights to apply in the preview buffer
   */
  highlights?: PreviewHighlight[];

  /**
   * Line number of preview buffer to be made center and highlighted
   */
  lineNr?: number;

  /**
   * Pattern to jump to and highlight
   */
  pattern?: string;

  /**
   * Syntax to apply in the preview buffer
   */
  syntax?: string;
};

/**
 *  Previewer defines how the preview is rendered
 *  This must be implemented in the ddu-ui
 */
export type Previewer =
  | TerminalPreviewer
  | BufferPreviewer
  | NoFilePreviewer;

export type ClipboardAction = "none" | "move" | "copy" | "link";

export type Clipboard = {
  action: ClipboardAction;
  items: DduItem[];
  mode: string;
  paster?: never;
};
