import type { Denops } from "@denops/std";

export type DduExtType = "ui" | "source" | "filter" | "kind" | "column";

export type DduAliasType = DduExtType | "action";

export type DduEvent = "close" | "cancel";

export type BaseParams = Record<string, unknown>;

export type UiName = string;
export type SourceName = string;
export type FilterName = string;
export type KindName = string;
export type ColumnName = string;
export type ActionName = string;

export type UiActionCallback<Params extends BaseParams> = (
  args: UiActionArguments<Params>,
) => ActionFlags | Promise<ActionFlags>;
export type ActionCallback<Params extends BaseParams> = (
  args: ActionArguments<Params>,
) => ActionFlags | ActionResult | Promise<ActionFlags | ActionResult>;

// TreePath is the path (string) or list of the path segments(string[])
// You can represents two ways for one path like below.
//    "/aa/bb/cc"
//    ["/", "aa", "bb", "cc"]
export type TreePath = string | string[];

export type UserUi = UiName | {
  name: UiName;
  options?: Partial<UiOptions>;
  params?: Partial<BaseParams>;
};

export type UserSource = SourceName | {
  name: SourceName;
  options?: Partial<SourceOptions>;
  params?: Partial<BaseParams>;
};

export type UserFilter = FilterName | {
  name: FilterName;
  options?: Partial<FilterOptions>;
  params?: Partial<BaseParams>;
};

export type UserColumn = ColumnName | {
  name: ColumnName;
  options?: Partial<ColumnOptions>;
  params?: Partial<BaseParams>;
};

export type SourceInfo = {
  name: SourceName;
  index: number;
  path: TreePath;
  kind: string;
};

export type Context = {
  bufName: string;
  bufNr: number;
  cwd: string;
  done: boolean;
  doneUi: boolean;
  input: string;
  maxItems: number;
  mode: string;
  path: TreePath;
  pathHistories: TreePath[];
  winId: number;
};

export interface ContextBuilder {
  get(denops: Denops, options: UserOptions): Promise<[Context, DduOptions]>;
  getGlobal(): Partial<DduOptions>;
  getLocal(): Record<string, Partial<DduOptions>>;
  setGlobal(options: Partial<DduOptions>): void;
  setLocal(name: string, options: Partial<DduOptions>): void;
  patchGlobal(options: Partial<DduOptions>): void;
  patchLocal(name: string, options: Partial<DduOptions>): void;
}

export type DduOptions = {
  actionOptions: Record<ActionName, Partial<ActionOptions>>;
  actionParams: Record<ActionName, Partial<BaseParams>>;
  actions: string[];
  columnOptions: Record<ColumnName, Partial<ColumnOptions>>;
  columnParams: Record<ColumnName, Partial<BaseParams>>;
  expandInput: boolean;
  filterOptions: Record<FilterName, Partial<FilterOptions>>;
  filterParams: Record<FilterName, Partial<BaseParams>>;
  input: string;
  kindOptions: Record<KindName, Partial<KindOptions>>;
  kindParams: Record<KindName, Partial<BaseParams>>;
  name: string;
  postFilters: UserFilter[];
  profile: boolean;
  push: boolean;
  refresh: boolean;
  resume: boolean;
  searchPath: TreePath;
  sourceOptions: Record<SourceName, Partial<SourceOptions>>;
  sourceParams: Record<SourceName, Partial<BaseParams>>;
  sources: UserSource[];
  sync: boolean;
  syncLimit: number;
  syncTimeout: number;
  ui: UserUi;
  uiOptions: Record<UiName, Partial<UiOptions>>;
  uiParams: Record<UiName, Partial<BaseParams>>;
  unique: boolean;
};

export type UserOptions = Record<string, unknown>;

export type UiAction = string | UiActionCallback<BaseParams>;
export type ItemAction = string | Action<BaseParams>;

export type UiOptions = {
  actions: Record<ActionName, UiAction>;
  defaultAction: string;
  filterInputFunc: string;
  filterInputOptsFunc: string;
  filterPrompt: string;
  filterUpdateCallback: string;
  filterUpdateMax: number;
  persist: boolean;
  toggle: boolean;
};

export type SourceOptions = {
  actions: Record<ActionName, ItemAction>;
  columns: UserColumn[];
  converters: UserFilter[];
  defaultAction: string;
  ignoreCase: boolean;
  limitPath: TreePath;
  matcherKey: string;
  matchers: UserFilter[];
  maxItems: number;
  path: TreePath;
  preview: boolean;
  smartCase: boolean;
  sorters: UserFilter[];
  volatile: boolean;
};

export type FilterOptions = {
  minInputLength: number;
};

export type ColumnOptions = {
  // TODO: Add options and remove placeholder
  placeholder?: unknown;
};

export type KindOptions = {
  actions: Record<ActionName, ItemAction>;
  defaultAction: string;
};

export type ActionOptions = {
  quit: boolean;
};

export type ItemHighlight = {
  name: string;
  hl_group: string;
  col: number;
  width: number;
};

export type ItemStatus = {
  size?: number;
  time?: number;
};

export type ItemInfo = {
  text: string;
  hl_group?: string;
};

export type Item<
  ActionData extends unknown = unknown,
> = {
  word: string;
  display?: string;
  action?: ActionData;
  data?: unknown;
  highlights?: ItemHighlight[];
  status?: ItemStatus;
  kind?: string;
  level?: number;
  treePath?: TreePath;
  isExpanded?: boolean;
  isTree?: boolean;
  info?: ItemInfo[];
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
    __columnTexts: Record<number, string>;
    __groupedPath: string;
  };

export type ExpandItem = {
  item: DduItem;
  maxLevel?: number;
  search?: TreePath;
  isGrouped?: boolean;
  isInTree?: boolean;
};

export type DduFilterItems = DduItem[] | {
  items: DduItem[];
  input?: string;
  postActionCommand?: string;
};

export type UiActionArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  actionParams: BaseParams;
  getPreviewer?: (
    denops: Denops,
    item: DduItem,
    actionParams: BaseParams,
    previewContext: PreviewContext,
  ) => Promise<Previewer | undefined>;
  inputHistory: string[];
};

export type ActionArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  kindOptions: KindOptions;
  kindParams: Params;
  actionParams: BaseParams;
  items: DduItem[];
  clipboard: Clipboard;
  actionHistory: ActionHistory;
};

export type Actions<Params extends BaseParams> = Record<
  ActionName,
  Action<Params>
>;

export type Action<Params extends BaseParams> = {
  description: string;
  callback: ActionCallback<Params>;
} | ActionCallback<Params>;

export enum ActionFlags {
  None = 0,
  RefreshItems = 1 << 0,
  Redraw = 1 << 1,
  Persist = 1 << 2,
  RestoreCursor = 1 << 3,
}

export type ActionResult = {
  flags: ActionFlags;
  searchPath: TreePath;
};

/**
 * Information of preview window
 */
export type PreviewContext = {
  row: number;
  col: number;
  width: number;
  height: number;
  isFloating: boolean;
  split: "horizontal" | "vertical" | "no";
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
   * Commands passed to terminal API to render the preview
   */
  cmds: string[];

  /**
   * Current working directory
   */
  cwd?: string;
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

type BufferPreviewerBase = {
  kind: "buffer";
} & PreviewerCommon;

type NewBufferPreviewer = {
  /**
   * Buffer expression, which is the same as the arguments of `bufname()`
   */
  expr?: number | string;

  /**
   * Path of file to preview
   */
  path?: string;

  useExisting?: false;
};

type ExistingBufferPreviewer = {
  expr: number | string;

  path?: undefined;

  /**
   * Use existing buffer
   */
  useExisting: true;
};

/**
 * Preview type which shows the contents of files or existing buffers
 */
export type BufferPreviewer =
  & BufferPreviewerBase
  & (NewBufferPreviewer | ExistingBufferPreviewer);

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

  /**
   * Filetype to apply in the preview buffer
   */
  filetype?: string;
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

export type ActionHistory = {
  actions: {
    name: ActionName;
    item?: DduItem;
    dest?: string;
  }[];
};
