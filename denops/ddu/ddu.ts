import {
  assertEquals,
  basename,
  deferred,
  Denops,
  equal,
  fn,
  is,
  Lock,
  pathsep,
} from "./deps.ts";
import {
  Action,
  ActionFlags,
  ActionHistory,
  ActionOptions,
  BaseActionParams,
  BaseColumn,
  BaseColumnParams,
  BaseFilter,
  BaseFilterParams,
  BaseKind,
  BaseKindParams,
  BaseSource,
  BaseSourceParams,
  BaseUi,
  BaseUiParams,
  Clipboard,
  ColumnOptions,
  Context,
  DduEvent,
  DduItem,
  DduOptions,
  ExpandItem,
  FilterOptions,
  Item,
  KindOptions,
  PreviewContext,
  Previewer,
  SourceInfo,
  SourceOptions,
  TreePath,
  UiOptions,
  UserColumn,
  UserFilter,
  UserOptions,
  UserSource,
} from "./types.ts";
import {
  defaultContext,
  defaultDduOptions,
  defaultDummy,
  foldMerge,
  mergeActionOptions,
  mergeActionParams,
  mergeColumnOptions,
  mergeColumnParams,
  mergeDduOptions,
  mergeFilterOptions,
  mergeFilterParams,
  mergeKindOptions,
  mergeKindParams,
  mergeSourceOptions,
  mergeSourceParams,
  mergeUiOptions,
  mergeUiParams,
} from "./context.ts";
import { defaultUiOptions } from "./base/ui.ts";
import { defaultSourceOptions, GatherArguments } from "./base/source.ts";
import { defaultFilterOptions } from "./base/filter.ts";
import { defaultColumnOptions } from "./base/column.ts";
import { defaultKindOptions } from "./base/kind.ts";
import { defaultActionOptions } from "./base/action.ts";
import { Loader } from "./loader.ts";
import { errorException, treePath2Filename } from "./utils.ts";

type GatherState = {
  items: DduItem[];
  done: boolean;
};

type ItemActions = {
  source: BaseSource<BaseSourceParams, unknown>;
  kind: BaseKind<BaseKindParams>;
  actions: Record<string, unknown>;
};

type RedrawOptions = {
  /**
   * NOTE: Set restoreItemState to true if redraw without regather because
   * item's states reset to gathered.
   */
  restoreItemState?: boolean;
};

type ItemAction = {
  userSource: UserSource;
  sourceOptions: SourceOptions;
  sourceParams: BaseSourceParams;
  kindOptions: KindOptions;
  kindParams: BaseKindParams;
  actionOptions: ActionOptions;
  actionParams: BaseActionParams;
  action: string | Action<BaseActionParams>;
};

export class Ddu {
  private loader: Loader;
  private gatherStates: Record<string, GatherState> = {};
  private input = "";
  private context: Context = defaultContext();
  private options: DduOptions = defaultDduOptions();
  private userOptions: UserOptions = {};
  private initialized = false;
  private quitted = false;
  private cancelledToRefresh = false;
  private abortController = new AbortController();
  private uiRedrawLock = new Lock(0);
  private waitRedrawComplete?: Promise<void>;
  private scheduledRedrawOptions?: RedrawOptions;
  private startTime = 0;
  private expandedPaths = new Set<string[]>();
  private searchPath: TreePath = "";
  private items: DduItem[] = [];

  constructor(loader: Loader) {
    this.loader = loader;
  }

  async start(
    denops: Denops,
    context: Context,
    options: DduOptions,
    userOptions: UserOptions,
  ): Promise<void> {
    const prevContext = { ...this.context };

    this.context = context;
    this.userOptions = userOptions;

    const resume =
      (userOptions?.resume === undefined && this.options?.resume) ||
      userOptions?.resume;
    const uiChanged = userOptions?.ui && this.options.ui !== "" &&
      userOptions?.ui !== this.options.ui;

    if (uiChanged) {
      // Quit current UI
      const [ui, uiOptions, uiParams] = await this.getUi(denops);
      if (!ui) {
        return;
      }
      await this.uiQuit(denops, ui, uiOptions, uiParams);
      this.quit();
    }

    const checkToggle = this.initialized && !this.shouldStopCurrentContext() &&
      !userOptions?.refresh;

    if (
      this.initialized && resume && !uiChanged &&
      prevContext.done && this.context.cwd === prevContext.cwd &&
      (!userOptions?.sources ||
        equal(userOptions.sources, this.options.sources))
    ) {
      // NOTE: sources must not overwrite
      userOptions.sources = this.options.sources;

      this.updateOptions(userOptions);

      // Set input
      if (userOptions?.input !== undefined) {
        await this.setInput(denops, userOptions.input as string);
      } else if (prevContext.input !== "") {
        await this.setInput(denops, prevContext.input);
      }

      // Restore
      this.context.path = prevContext.path;
      this.context.maxItems = prevContext.maxItems;

      const [ui, uiOptions, uiParams] = await this.getUi(denops);
      if (!ui) {
        return;
      }

      if (checkToggle && uiOptions.toggle) {
        await this.uiQuit(denops, ui, uiOptions, uiParams);
        this.quit();
        return;
      }

      if (userOptions.searchPath) {
        // Apply only defined by new options
        this.searchPath = userOptions.searchPath as string;
      }

      if (!this.options?.refresh) {
        this.resetQuitted();

        if (this.searchPath) {
          // Redraw only without regather items.
          return this.redraw(denops, { restoreItemState: true });
        }

        // UI Redraw only
        // NOTE: Enable done to redraw UI properly
        this.context.done = true;
        await uiRedraw(
          denops,
          this,
          this.uiRedrawLock,
          ui,
          uiOptions,
          uiParams,
        );
        this.context.doneUi = true;
        return;
      }
    } else {
      this.gatherStates = {};
      this.options = options;
      await this.setInput(denops, this.options.input);
    }

    if (this.options.searchPath.length > 0) {
      this.searchPath = this.options.searchPath;
    }

    // NOTE: UI must be reset.
    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    if (checkToggle && ui && uiOptions.toggle) {
      await this.uiQuit(denops, ui, uiOptions, uiParams);
      this.quit();
      return;
    }

    if (ui) {
      ui.isInitialized = false;
    }

    this.initialized = false;
    this.resetQuitted();

    // Source onInit() must be called before UI
    for (
      const userSource of this.options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, sourceParams] = await this.getSource(
        denops,
        userSource.name,
        userSource,
      );
      if (!source) {
        return;
      }

      await initSource(
        denops,
        source,
        sourceOptions,
        sourceParams,
        this.loader,
      );
    }

    // UI should load before refresh.
    // NOTE: If UI is blocked until refresh, user input will break UI.
    await this.uiRedraw(denops);

    await this.refresh(denops);

    this.initialized = true;
  }

  async restart(
    denops: Denops,
    userOptions: UserOptions,
  ): Promise<void> {
    // Quit current UI
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }
    await this.uiQuit(denops, ui, uiOptions, uiParams);
    this.quit();

    // Disable resume
    userOptions.resume = false;

    // Restart
    this.updateOptions(userOptions);
    await this.start(
      denops,
      this.context,
      this.options,
      userOptions,
    );
  }

  async refresh(
    denops: Denops,
    refreshIndexes: number[] = [],
  ): Promise<void> {
    this.startTime = Date.now();

    // Clean up previous gather state
    this.cancelToRefresh();
    for (const state of Object.values(this.gatherStates)) {
      while (!state.done) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    this.resetCancelledToRefresh();

    // Initialize UI window
    if (!this.options.sync) {
      // Do not await here
      this.redraw(denops);
    }

    await Promise.all(
      this.options.sources.map(
        async (userSource: UserSource, index: number): Promise<void> => {
          if (refreshIndexes.length > 0 && !refreshIndexes.includes(index)) {
            // Skip
            return;
          }

          userSource = convertUserString(userSource);

          const state: GatherState = {
            items: [],
            done: false,
          };

          this.gatherStates[index] = state;

          const [source, sourceOptions, sourceParams] = await this.getSource(
            denops,
            userSource.name,
            userSource,
          );
          if (!source) {
            state.done = true;
            return;
          }

          // Start gather asynchronously
          const gatherItems = this.gatherItems(
            denops,
            index,
            source,
            sourceOptions,
            sourceParams,
            this.loader,
            0,
          );

          // Call "onRefreshItems" hooks
          const filters = sourceOptions.matchers.concat(
            sourceOptions.sorters,
          ).concat(sourceOptions.converters);
          await Promise.all(filters.map(async (userFilter) => {
            const [filter, filterOptions, filterParams] = await this.getFilter(
              denops,
              userFilter,
            );
            await filter?.onRefreshItems?.({
              denops,
              filterOptions,
              filterParams,
            });
          }));

          // Get path option, or current directory instead if it is empty
          const path = sourceOptions.path.length > 0
            ? sourceOptions.path
            : await fn.getcwd(denops);

          let prevLength = state.items.length;

          for await (const newItems of gatherItems) {
            if (path !== this.context.path) {
              if (this.context.path.length > 0) {
                this.context.pathHistories.push(this.context.path);
              }
              this.context.path = path;
            }

            state.items = state.items.concat(newItems);

            if (!this.options.sync && prevLength !== state.items.length) {
              // Do not await inside loop
              this.redraw(denops);
              prevLength = state.items.length;
            }
          }

          state.done = true;

          if (!this.options.sync) {
            await this.redraw(denops);
          }
        },
      ),
    );

    if (this.options.sync) {
      await this.redraw(denops);
    } else {
      // Wait complete redraw
      await this.waitRedrawComplete;
    }
  }

  private newDduItem<
    Params extends BaseSourceParams,
    UserData extends unknown,
  >(
    sourceIndex: number,
    source: BaseSource<Params, UserData>,
    sourceOptions: SourceOptions,
    item: Item,
    level?: number,
  ): DduItem {
    const matcherKey = (sourceOptions.matcherKey in item)
      ? (item as Record<string, unknown>)[
        sourceOptions.matcherKey
      ] as string
      : item.word;
    if (item.isExpanded && item.treePath) {
      this.expandedPaths.add(convertTreePath(item.treePath));
    }
    return {
      ...item,
      kind: item.kind ?? source.kind,
      matcherKey,
      __sourceIndex: sourceIndex,
      __sourceName: source.name,
      __level: item.level ?? level ?? 0,
      __expanded: Boolean(
        item.treePath &&
          this.isExpanded(convertTreePath(item.treePath)),
      ),
    };
  }

  async *gatherItems<
    Params extends BaseSourceParams,
    UserData extends unknown,
  >(
    denops: Denops,
    index: number,
    source: BaseSource<Params, UserData>,
    sourceOptions: SourceOptions,
    sourceParams: Params,
    loader: Loader,
    itemLevel: number,
    parent?: DduItem,
  ): AsyncGenerator<DduItem[], void, undefined> {
    const { signal } = this.abortController;
    if (signal.aborted) {
      return;
    }

    const itemTransformer = new TransformStream<Item[], DduItem[]>({
      transform: (chunk, controller) => {
        const newItems = chunk.map((item: Item) =>
          this.newDduItem(
            index,
            source,
            sourceOptions,
            item,
            itemLevel,
          )
        );
        controller.enqueue(newItems);
      },
    });

    try {
      yield* source.gather({
        denops,
        context: this.context,
        options: this.options,
        sourceOptions,
        sourceParams,
        input: this.input,
        parent,
        loader,
      }).pipeThrough(itemTransformer, { signal });
    } catch (e: unknown) {
      if (signal.aborted && e === signal.reason) {
        // Aborted by signal, so do nothing.
      } else {
        await errorException(
          denops,
          e,
          `source: ${source.name} "gather()" failed`,
        );
      }
    }
  }

  redraw(
    denops: Denops,
    opts?: RedrawOptions,
  ): Promise<void> {
    if (this.waitRedrawComplete) {
      // Already redrawing, so adding to schedule
      this.scheduledRedrawOptions = {
        // Override with true
        restoreItemState: opts?.restoreItemState ||
          this.scheduledRedrawOptions?.restoreItemState,
      };
    } else {
      // Start redraw
      const complete = this.waitRedrawComplete = deferred<void>();

      const scheduleRunner = async (opts?: RedrawOptions) => {
        try {
          await this.redrawInternal(denops, opts);

          opts = this.scheduledRedrawOptions;
          if (opts) {
            // Scheduled to redraw
            this.scheduledRedrawOptions = undefined;
            scheduleRunner(opts);
          } else {
            // All schedules completed
            this.waitRedrawComplete = undefined;
            complete.resolve();
          }
        } catch (e: unknown) {
          complete.reject(e);
        }
      };

      scheduleRunner(opts);
    }

    return this.waitRedrawComplete;
  }

  private async redrawInternal(
    denops: Denops,
    opts?: RedrawOptions,
  ): Promise<void> {
    // Update current input
    this.context.done = true;
    this.context.doneUi = false;
    this.context.input = this.input;
    this.context.maxItems = 0;

    const sources: SourceInfo[] = [];
    let allItems: DduItem[] = [];
    let index = 0;
    for (
      const userSource of this.options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, _] = await this.getSource(
        denops,
        userSource.name,
        userSource,
      );
      if (!source) {
        return;
      }
      sources.push({
        name: userSource.name,
        index,
        path: sourceOptions.path,
        kind: source.kind ?? "base",
      });

      const [done, maxItems, items] = await this.filterItems(
        denops,
        userSource,
        index,
        this.input,
      );
      if (opts?.restoreItemState) {
        items.forEach((item) => {
          if (item.treePath) {
            item.__expanded = this.isExpanded(convertTreePath(item.treePath));
          }
        });
      }
      allItems = allItems.concat(items);
      this.context.done = done && this.context.done;
      this.context.maxItems += maxItems;

      index++;
    }

    // Post filters
    allItems = await this.callFilters(
      denops,
      defaultSourceOptions(),
      this.options.postFilters,
      this.input,
      allItems,
    );

    if (this.options.unique) {
      // Unique all items

      const words = new Set<string>();
      allItems = allItems.reduce((items: DduItem[], item) => {
        if (!words.has(item.word)) {
          words.add(item.word);
          items.push(item);
        }
        return items;
      }, []);
      this.context.maxItems = allItems.length;
    }

    this.items = allItems;

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui || this.shouldStopCurrentContext()) {
      return;
    }

    await ui.refreshItems({
      denops,
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      sources: sources,
      items: allItems,
    });

    const searchPath = this.searchPath;

    // Prevent infinite loop
    this.searchPath = "";

    let searchTargetItem: DduItem | undefined;

    await Promise.all(allItems.map(async (item: DduItem): Promise<void> => {
      if (searchPath) {
        if (searchPath === item.treePath ?? item.word) {
          searchTargetItem = item;
        }
        if (
          !searchTargetItem && item.treePath &&
          isParentPath(
            convertTreePath(item.treePath),
            convertTreePath(searchPath),
          )
        ) {
          searchTargetItem = await this.expandItem(
            denops,
            item,
            {
              maxLevel: -1,
              search: searchPath,
              preventRedraw: true,
            },
          );
          return;
        }
      }

      if (item.__expanded && !item.isExpanded) {
        await this.expandItem(
          denops,
          item,
          {
            maxLevel: -1,
            search: searchPath,
            preventRedraw: true,
          },
        );
      }
    }));

    if (this.context.done && this.options.profile) {
      await denops.call(
        "ddu#util#print_error",
        `Refresh all items: ${Date.now() - this.startTime} ms`,
      );
    }

    await this.uiRedraw(denops, searchTargetItem);

    this.context.doneUi = this.context.done;
  }

  async uiRedraw(
    denops: Denops,
    searchItem?: DduItem,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui || this.shouldStopCurrentContext()) {
      return;
    }

    await uiRedraw(
      denops,
      this,
      this.uiRedrawLock,
      ui,
      uiOptions,
      uiParams,
    );

    if (searchItem) {
      await ui.searchItem({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
        item: searchItem,
      });
    }
  }

  async uiQuit<
    Params extends BaseUiParams,
  >(
    denops: Denops,
    ui: BaseUi<Params>,
    uiOptions: UiOptions,
    uiParams: Params,
  ): Promise<void> {
    await ui.quit({
      denops,
      context: this.context,
      options: this.options,
      uiOptions,
      uiParams,
    });
  }

  async onEvent(
    denops: Denops,
    event: DduEvent,
  ): Promise<void> {
    for (
      const userSource of this.options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, sourceParams] = await this.getSource(
        denops,
        userSource.name,
        userSource,
      );
      if (!source) {
        continue;
      }

      // The source may not have "onEvent"
      if (!source.onEvent) {
        continue;
      }

      await source.onEvent({
        denops,
        sourceOptions,
        sourceParams,
        event,
      });
    }
  }

  quit() {
    // NOTE: quitted flag must be called after uiQuit().
    this.quitted = true;
    this.abortController.abort("quit");
    this.context.done = true;
  }

  private resetQuitted() {
    this.quitted = false;
    this.resetAbortController();
  }

  private cancelToRefresh() {
    this.cancelledToRefresh = true;
    this.abortController.abort("cancelToRefresh");
  }

  private resetCancelledToRefresh() {
    this.cancelledToRefresh = false;
    this.resetAbortController();
  }

  private resetAbortController() {
    if (
      !this.shouldStopCurrentContext() && this.abortController.signal.aborted
    ) {
      this.abortController = new AbortController();
    }
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    actionParams: BaseActionParams,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }

    if (ui.onBeforeAction) {
      await ui.onBeforeAction({
        denops,
        uiOptions,
        uiParams,
      });
    }

    const action = uiOptions.actions[actionName] ?? ui.actions[actionName];
    if (!action) {
      await denops.call(
        "ddu#util#print_error",
        `Not found UI action: ${actionName}`,
      );
      return;
    }

    let ret;
    if (typeof action === "string") {
      ret = await denops.call(
        "denops#callback#call",
        action,
        {
          context: this.context,
          options: this.options,
          uiOptions,
          uiParams,
          actionParams,
        },
      ) as ActionFlags;
    } else {
      ret = await action({
        denops,
        ddu: this,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
        actionParams,
        getPreviewer: this.getPreviewer.bind(this),
      });
    }

    if (ui.onAfterAction) {
      await ui.onAfterAction({
        denops,
        uiOptions,
        uiParams,
      });
    }

    const flags = typeof ret === "number" ? ret : ActionFlags.None;

    if (flags & ActionFlags.RefreshItems) {
      await this.refresh(denops);
    } else if (flags & ActionFlags.Redraw) {
      await ui.redraw({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
      });
    }
  }

  async getItemActionNames(
    denops: Denops,
    items: DduItem[],
  ): Promise<ItemActions | null> {
    const sources = [
      ...new Set(
        items.length > 0
          ? items.map((item) =>
            this.loader.getSource(this.options.name, item.__sourceName)
          )
          : this.options.sources.map((userSource) =>
            this.loader.getSource(
              this.options.name,
              convertUserString(userSource).name,
            )
          ),
      ),
    ].filter((source) => source);
    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];
    if (sources.length === 0 || sources.length !== 1 && indexes.length !== 1) {
      if (sources.length > 0) {
        await denops.call(
          "ddu#util#print_error",
          `You must not mix multiple sources items: "${
            sources.map((source) => source?.name)
          }"`,
        );
      }
      return null;
    }
    const source = sources[0];
    if (!source) {
      return null;
    }

    const kinds = [
      ...new Set(
        items.length > 0
          ? items.map((item) => item.kind)
          : sources.map((source) => source?.kind),
      ),
    ] as string[];
    if (kinds.length !== 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple kinds: "${kinds}"`,
      );
      return null;
    }

    const kindName = kinds[0];
    const kind = await this.getKind(denops, kindName);
    if (!kind) {
      return null;
    }

    const [kindOptions, _1] = kindArgs(kind, this.options);
    const [sourceOptions, _2] = sourceArgs(
      source,
      this.options,
      this.options.sources[indexes.length > 0 ? indexes[0] : 0],
    );

    return {
      source,
      kind,
      actions: Object.assign(
        kind.actions,
        kindOptions.actions,
        source.actions,
        sourceOptions.actions,
      ),
    };
  }

  async getItemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    userActionParams: BaseActionParams,
  ): Promise<ItemAction | undefined> {
    if (items.length === 0) {
      return;
    }

    const itemActions = await this.getItemActionNames(denops, items);
    if (!itemActions) {
      return;
    }

    const { source, kind, actions } = itemActions;

    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];

    const userSource = this.options.sources[
      indexes.length > 0 ? indexes[0] : 0
    ];
    const [sourceOptions, sourceParams] = sourceArgs(
      source,
      this.options,
      userSource,
    );

    const [kindOptions, kindParams] = kindArgs(kind, this.options);

    // Get default action in the first
    if (actionName === "default") {
      actionName = sourceOptions.defaultAction;
      if (actionName === "") {
        // Use kind default action
        actionName = kindOptions.defaultAction;
      }

      if (actionName === "") {
        await denops.call(
          "ddu#util#print_error",
          `The default action is not defined for the items`,
        );
        return;
      }
    }

    // NOTE: "actionName" may be overwritten by aliases
    const [actionOptions, actionParams] = actionArgs(
      actionName,
      this.options,
      userActionParams,
    );

    // Check action aliases
    actionName = this.loader.getAlias("action", actionName) ?? actionName;

    const action = actions[actionName] as
      | string
      | Action<BaseActionParams>;
    if (!action) {
      await denops.call(
        "ddu#util#print_error",
        `Not found action: ${actionName}`,
      );
      return;
    }

    return {
      userSource,
      sourceOptions,
      sourceParams,
      kindOptions,
      kindParams,
      actionOptions,
      actionParams,
      action,
    };
  }

  async itemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    userActionParams: BaseActionParams,
    clipboard: Clipboard,
    actionHistory: ActionHistory,
  ): Promise<void> {
    const itemAction = await this.getItemAction(
      denops,
      actionName,
      items,
      userActionParams,
    );
    if (!itemAction) {
      return;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (ui) {
      const visible = await ui.visible({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
        tabNr: await fn.tabpagenr(denops),
      });

      if (itemAction.actionOptions.quit && visible) {
        // Quit UI before action
        await this.uiQuit(denops, ui, uiOptions, uiParams);
      }
    }

    const prevPath = itemAction.sourceOptions.path;
    let ret;
    if (typeof itemAction.action === "string") {
      ret = await denops.call(
        "denops#callback#call",
        itemAction.action,
        {
          context: this.context,
          options: this.options,
          actionParams: itemAction.actionParams,
          items,
        },
      ) as ActionFlags;
    } else {
      const func = typeof itemAction.action === "object"
        ? itemAction.action.callback
        : itemAction.action;

      ret = await func({
        denops,
        context: this.context,
        options: this.options,
        sourceOptions: itemAction.sourceOptions,
        sourceParams: itemAction.sourceParams,
        kindOptions: itemAction.kindOptions,
        kindParams: itemAction.kindParams,
        actionParams: itemAction.actionParams,
        items,
        clipboard,
        actionHistory,
      });
    }

    let flags = ActionFlags.None;
    let searchPath: TreePath = "";
    if (typeof ret === "object") {
      flags = ret.flags;
      searchPath = ret.searchPath;
    } else if (typeof ret === "number") {
      flags = ret;
    }

    // Check path is changed by action
    if (itemAction.sourceOptions.path !== prevPath) {
      itemAction.userSource = convertUserString(itemAction.userSource);
      // Overwrite current path
      if (!itemAction.userSource.options) {
        itemAction.userSource.options = itemAction.sourceOptions;
      }
      itemAction.userSource.options.path = itemAction.sourceOptions.path;
      if (this.context.path.length > 0) {
        this.context.pathHistories.push(this.context.path);
      }

      this.context.path = itemAction.sourceOptions.path;

      // Clear input when path is changed
      await this.setInput(denops, "");
    }

    if (searchPath.length > 0) {
      this.searchPath = searchPath;
    }

    const winId = await fn.win_getid(denops);

    if (flags & ActionFlags.RefreshItems) {
      // Restore quitted flag before refresh and redraw
      this.resetQuitted();
      await this.refresh(denops);
    } else if (uiOptions.persist || flags & ActionFlags.Persist) {
      // Restore quitted flag before refresh and redraw
      this.resetQuitted();

      if (ui) {
        await ui.redraw({
          denops,
          context: this.context,
          options: this.options,
          uiOptions,
          uiParams,
        });
      }
    }

    if (flags & ActionFlags.RestoreCursor) {
      // Restore the cursor
      await fn.win_gotoid(denops, winId);
    }
  }

  async expandItems(
    denops: Denops,
    items: ExpandItem[],
  ): Promise<void> {
    const searchedItems = await Promise.all(items.map((item) => {
      const maxLevel = item.maxLevel && item.maxLevel < 0
        ? -1
        : item.item.__level + (item.maxLevel ?? 0);
      return this.expandItem(
        denops,
        item.item,
        item.search === undefined
          ? {
            maxLevel: maxLevel,
            preventRedraw: true,
          }
          : {
            maxLevel: maxLevel,
            search: item.search,
            preventRedraw: true,
          },
      );
    }));

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (ui && !this.shouldStopCurrentContext()) {
      await uiRedraw(
        denops,
        this,
        this.uiRedrawLock,
        ui,
        uiOptions,
        uiParams,
      );

      if (searchedItems.length === 1) {
        await ui.searchItem({
          denops,
          context: this.context,
          options: this.options,
          uiOptions,
          uiParams,
          item: searchedItems[0] ?? items[0].item,
        });
      }
    }
  }

  async expandItem(
    denops: Denops,
    parent: DduItem,
    options: {
      // Expand recursively to the maxLevel
      maxLevel: number;
      preventRedraw?: boolean;
    } | {
      // Expand recursively to find the `search` path
      search: TreePath;
      maxLevel: number;
      preventRedraw?: boolean;
    },
  ): Promise<DduItem /* searchedItem */ | undefined> {
    if (parent.__level < 0 || !parent.isTree || !parent.treePath) {
      return;
    }

    const index = parent.__sourceIndex;
    const source = this.loader.getSource(
      this.options.name,
      parent.__sourceName,
    );
    if (!source) {
      return;
    }
    const [sourceOptions, sourceParams] = sourceArgs(
      source,
      this.options,
      this.options.sources[index],
    );

    this.setExpanded(convertTreePath(parent.treePath));
    parent.__expanded = true;

    // Set path
    const savePath = this.context.path;
    sourceOptions.path = parent.treePath ?? parent.word;
    this.context.path = sourceOptions.path;

    let children: DduItem[] = [];

    try {
      for await (
        const newItems of this.gatherItems(
          denops,
          index,
          source,
          sourceOptions,
          sourceParams,
          this.loader,
          parent.__level + 1,
          parent,
        )
      ) {
        await this.callColumns(
          denops,
          sourceOptions.columns,
          [parent].concat(newItems),
        );
        children = children.concat(newItems);
      }
      if (this.shouldStopCurrentContext()) {
        return;
      }

      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);

      children = await this.callFilters(
        denops,
        sourceOptions,
        filters,
        this.input,
        children,
      );
    } finally {
      // Restore path
      this.context.path = savePath;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (ui && !this.shouldStopCurrentContext()) {
      await ui.expandItem({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
        parent,
        children,
      });
    }

    let searchedItem: DduItem | undefined;

    if (options.maxLevel < 0 || parent.__level < options.maxLevel) {
      const expandTargetChildren = "search" in options
        ? children.filter((child) =>
          // Expand recursively to find the `search` path
          child.__expanded ||
          child.isTree && child.treePath &&
            isParentPath(
              convertTreePath(child.treePath),
              convertTreePath(options.search),
            )
        )
        : children.filter((child) =>
          // Expand recursively to the maxLevel
          child.__expanded ||
          child.isTree && child.treePath &&
            // NOTE: Skip hidden directory
            !basename(treePath2Filename(child.treePath)).startsWith(".")
        );

      if (expandTargetChildren.length > 0) {
        // Expand is not completed yet.
        const childOptions = {
          ...options,
          preventRedraw: true,
        };

        await Promise.all(
          expandTargetChildren.map(async (child: DduItem) => {
            const hit = await this.expandItem(
              denops,
              child,
              childOptions,
            );
            if (hit) {
              searchedItem = hit;
            }
          }),
        );
      }
    } else {
      // Collapse children exceed the maxLevel
      const expandedChildren = children.filter((child) => child.__expanded);
      if (expandedChildren.length > 0) {
        await this.collapseItems(denops, expandedChildren, true);
      }
    }

    if (
      "search" in options &&
      !searchedItem && parent.treePath &&
      isParentPath(
        convertTreePath(parent.treePath),
        convertTreePath(options.search),
      )
    ) {
      searchedItem = children.find((item) =>
        options.search === item.treePath ?? item.word
      );
    }

    if (ui && !this.shouldStopCurrentContext() && !options.preventRedraw) {
      await uiRedraw(
        denops,
        this,
        this.uiRedrawLock,
        ui,
        uiOptions,
        uiParams,
      );

      await ui.searchItem({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
        item: searchedItem ?? parent,
      });
    }

    return searchedItem;
  }

  async collapseItems(
    denops: Denops,
    items: DduItem[],
    preventRedraw?: boolean,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }

    for (const item of items) {
      const index = item.__sourceIndex;
      const source = this.loader.getSource(
        this.options.name,
        item.__sourceName,
      );
      const [sourceOptions, _] = sourceArgs(
        source,
        this.options,
        this.options.sources[index],
      );

      if (!item.treePath) {
        continue;
      }

      this.setUnexpanded(convertTreePath(item.treePath));
      item.__expanded = false;
      await this.callColumns(denops, sourceOptions.columns, [item]);

      await ui.collapseItem({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
        item,
      });
    }

    if (!preventRedraw) {
      await uiRedraw(
        denops,
        this,
        this.uiRedrawLock,
        ui,
        uiOptions,
        uiParams,
      );

      const searchItem = items.at(-1);

      if (searchItem) {
        await ui.searchItem({
          denops,
          context: this.context,
          options: this.options,
          uiOptions,
          uiParams,
          item: searchItem,
        });
      }
    }
  }

  async uiVisible(
    denops: Denops,
    tabNr: number,
  ): Promise<boolean> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui || !ui.visible || this.shouldStopCurrentContext()) {
      return false;
    }

    return await ui.visible({
      denops,
      context: this.context,
      options: this.options,
      uiOptions,
      uiParams,
      tabNr,
    });
  }

  async uiWinid(
    denops: Denops,
  ): Promise<number> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui || !ui.winId || this.shouldStopCurrentContext()) {
      return -1;
    }

    return await ui.winId({
      denops,
      context: this.context,
      options: this.options,
      uiOptions,
      uiParams,
    });
  }

  async setInput(denops: Denops, input: string) {
    if (this.options.expandInput) {
      input = await fn.expand(denops, input) as string;
    }
    this.input = input;
    this.context.input = input;
  }

  shouldStopCurrentContext(): boolean {
    return this.quitted || this.cancelledToRefresh;
  }

  getContext() {
    return this.context;
  }

  getOptions() {
    return this.options;
  }

  getUserOptions() {
    return this.userOptions;
  }

  getSourceArgs() {
    return this.options.sources.map((userSource) =>
      sourceArgs(
        this.loader.getSource(
          this.options.name,
          convertUserString(userSource).name,
        ),
        this.options,
        userSource,
      )
    );
  }

  getItems() {
    return this.items;
  }

  updateOptions(userOptions: UserOptions) {
    this.options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.options,
      userOptions,
    ]);
  }

  async checkUpdated(denops: Denops): Promise<boolean> {
    for (
      const userSource of this.options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, sourceParams] = await this.getSource(
        denops,
        userSource.name,
        userSource,
      );

      if (!source || !source.checkUpdated) {
        continue;
      }

      const updated = await source.checkUpdated({
        denops,
        context: this.context,
        options: this.options,
        sourceOptions,
        sourceParams,
      });

      if (updated) {
        return updated;
      }
    }

    return false;
  }

  private async getUi(
    denops: Denops,
  ): Promise<
    [
      BaseUi<BaseUiParams> | undefined,
      UiOptions,
      BaseUiParams,
    ]
  > {
    const userUi = convertUserString(this.options.ui);
    if (!this.loader.getUi(this.options.name, userUi.name)) {
      const startTime = Date.now();

      await this.loader.autoload(denops, "ui", userUi.name);

      if (this.options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${userUi.name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const ui = this.loader.getUi(this.options.name, userUi.name);
    if (!ui) {
      if (userUi.name.length !== 0) {
        await denops.call(
          "ddu#util#print_error",
          `Not found ui: "${userUi.name}"`,
        );
      }
      return [
        undefined,
        defaultUiOptions(),
        defaultDummy(),
      ];
    }

    const [uiOptions, uiParams] = uiArgs(this.options, ui);
    await checkUiOnInit(ui, denops, uiOptions, uiParams);

    return [ui, uiOptions, uiParams];
  }

  async getSource(
    denops: Denops,
    name: string,
    userSource: UserSource,
  ): Promise<
    [
      BaseSource<BaseSourceParams> | undefined,
      SourceOptions,
      BaseSourceParams,
    ]
  > {
    if (!this.loader.getSource(this.options.name, name)) {
      const startTime = Date.now();

      await this.loader.autoload(denops, "source", name);

      if (this.options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const source = this.loader.getSource(this.options.name, name);
    if (!source) {
      await denops.call(
        "ddu#util#print_error",
        `Not found source: ${name}`,
      );
      return [
        undefined,
        defaultSourceOptions(),
        defaultDummy(),
      ];
    }

    const [sourceOptions, sourceParams] = sourceArgs(
      source,
      this.options,
      userSource,
    );

    return [source, sourceOptions, sourceParams];
  }

  async getFilter(
    denops: Denops,
    userFilter: UserFilter,
  ): Promise<
    [
      BaseFilter<BaseFilterParams> | undefined,
      FilterOptions,
      BaseFilterParams,
    ]
  > {
    userFilter = convertUserString(userFilter);

    if (!this.loader.getFilter(this.options.name, userFilter.name)) {
      const startTime = Date.now();

      await this.loader.autoload(denops, "filter", userFilter.name);

      if (this.options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${userFilter.name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const filter = this.loader.getFilter(this.options.name, userFilter.name);
    if (!filter) {
      await denops.call(
        "ddu#util#print_error",
        `Not found filter: ${userFilter.name}`,
      );
      return [
        undefined,
        defaultFilterOptions(),
        defaultDummy(),
      ];
    }

    const [filterOptions, filterParams] = filterArgs(
      filter,
      this.options,
      userFilter,
    );
    await checkFilterOnInit(filter, denops, filterOptions, filterParams);

    return [filter, filterOptions, filterParams];
  }

  async getKind(
    denops: Denops,
    name: string,
  ): Promise<
    BaseKind<BaseKindParams> | undefined
  > {
    if (!this.loader.getKind(this.options.name, name)) {
      const startTime = Date.now();

      await this.loader.autoload(denops, "kind", name);

      if (this.options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const kind = this.loader.getKind(this.options.name, name);
    if (!kind) {
      if (name !== "base") {
        await denops.call(
          "ddu#util#print_error",
          `Not found kind: ${name}`,
        );
      }
      return undefined;
    }

    return kind;
  }

  async getColumn(
    denops: Denops,
    userColumn: UserColumn,
  ): Promise<
    [
      BaseColumn<BaseColumnParams> | undefined,
      ColumnOptions,
      BaseColumnParams,
    ]
  > {
    userColumn = convertUserString(userColumn);

    if (!this.loader.getColumn(this.options.name, userColumn.name)) {
      const startTime = Date.now();

      await this.loader.autoload(denops, "column", userColumn.name);

      if (this.options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${userColumn.name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const column = this.loader.getColumn(this.options.name, userColumn.name);
    if (!column) {
      await denops.call(
        "ddu#util#print_error",
        `Not found column: ${userColumn.name}`,
      );
      return [
        undefined,
        defaultColumnOptions(),
        defaultDummy(),
      ];
    }

    const [columnOptions, columnParams] = columnArgs(
      column,
      this.options,
      userColumn,
    );
    await checkColumnOnInit(column, denops, columnOptions, columnParams);

    return [column, columnOptions, columnParams];
  }

  private async filterItems(
    denops: Denops,
    userSource: UserSource,
    index: number,
    input: string,
  ): Promise<[boolean, number, DduItem[]]> {
    userSource = convertUserString(userSource);

    const [source, sourceOptions, _] = await this.getSource(
      denops,
      userSource.name,
      userSource,
    );

    const state = this.gatherStates[index];
    if (!state || !source) {
      return [false, 0, []];
    }

    // NOTE: Use deepcopy.  Because of filters may break original items.
    let items = structuredClone(state.items);
    const allItems = items.length;

    // NOTE: Call columns before filters
    await this.callColumns(denops, sourceOptions.columns, items);

    items = await this.callFilters(
      denops,
      sourceOptions,
      sourceOptions.matchers.concat(sourceOptions.sorters),
      input,
      items,
    );

    // Truncate before converters
    if (items.length > sourceOptions.maxItems) {
      items = items.slice(0, sourceOptions.maxItems);
    }

    items = await this.callFilters(
      denops,
      sourceOptions,
      sourceOptions.converters,
      input,
      items,
    );

    return [state.done, allItems, items];
  }

  private async callFilters(
    denops: Denops,
    sourceOptions: SourceOptions,
    filters: UserFilter[],
    input: string,
    items: DduItem[],
  ) {
    for (const userFilter of filters) {
      const [filter, filterOptions, filterParams] = await this.getFilter(
        denops,
        userFilter,
      );
      if (!filter) {
        continue;
      }

      try {
        const ret = await filter.filter({
          denops,
          context: this.context,
          options: this.options,
          sourceOptions,
          filterOptions,
          filterParams,
          input,
          items,
        });

        if (is.Array(ret)) {
          items = ret;
        } else {
          if (ret.input) {
            // Overwrite current input
            input = ret.input;
          }
          items = ret.items;
        }
      } catch (e: unknown) {
        await errorException(
          denops,
          e,
          `filter: ${filter.name} "filter()" failed`,
        );
      }
    }

    return items;
  }

  private async callColumns(
    denops: Denops,
    columns: UserColumn[],
    items: DduItem[],
  ) {
    if (columns.length === 0) {
      return items;
    }

    for (const item of items) {
      item.display = "";
      item.highlights = [];
    }

    type CachedColumn = {
      column: BaseColumn<BaseColumnParams>;
      columnOptions: ColumnOptions;
      columnParams: BaseColumnParams;
      length: number;
    };
    const cachedColumns: Record<string, CachedColumn> = {};
    for (
      const userColumn of columns.map((column) => convertUserString(column))
    ) {
      const [column, columnOptions, columnParams] = await this.getColumn(
        denops,
        userColumn,
      );
      if (!column) {
        continue;
      }

      const length = await column.getLength({
        denops,
        context: this.context,
        options: this.options,
        columnOptions,
        columnParams,
        items,
      });

      cachedColumns[userColumn.name] = {
        column,
        columnOptions,
        columnParams,
        length,
      };
    }

    for (const item of items) {
      let startCol = 1;
      for (
        const userColumn of columns.map((column) => convertUserString(column))
      ) {
        if (!cachedColumns[userColumn.name]) {
          continue;
        }

        const cachedColumn = cachedColumns[userColumn.name];
        const text = await cachedColumn.column.getText({
          denops,
          context: this.context,
          options: this.options,
          columnOptions: cachedColumn.columnOptions,
          columnParams: cachedColumn.columnParams,
          startCol,
          endCol: startCol + cachedColumn.length,
          item,
        });

        if (text.highlights && item.highlights) {
          item.highlights = item.highlights.concat(text.highlights);
        }

        if (item.display !== "") {
          item.display += " ";
        }
        item.display += text.text;

        startCol += cachedColumn.length + 1;
      }
    }
  }

  async getPreviewer(
    denops: Denops,
    item: DduItem,
    actionParams: BaseActionParams,
    previewContext: PreviewContext,
  ): Promise<Previewer | undefined> {
    const source = this.loader.getSource(this.options.name, item.__sourceName);
    if (!source) {
      return;
    }
    const kindName = source.kind;

    const kind = await this.getKind(denops, kindName);
    if (!kind || !kind.getPreviewer) {
      return;
    }

    return kind.getPreviewer({
      denops,
      options: this.options,
      actionParams,
      previewContext,
      item,
    });
  }

  private isExpanded(
    itemTreePath: string[],
  ): boolean {
    return Boolean(
      this.expandedPaths.has(itemTreePath),
    );
  }
  private setExpanded(
    itemTreePath: string[],
  ): void {
    this.expandedPaths.add(itemTreePath);
  }
  private setUnexpanded(
    itemTreePath: string[],
  ): void {
    [...this.expandedPaths].forEach((v) => {
      if (v === itemTreePath || isParentPath(itemTreePath, v)) {
        this.expandedPaths.delete(v);
      }
    });
  }
}

function uiArgs<
  Params extends BaseUiParams,
>(
  options: DduOptions,
  ui: BaseUi<Params>,
): [UiOptions, BaseUiParams] {
  const o = foldMerge(
    mergeUiOptions,
    defaultUiOptions,
    [
      options.uiOptions["_"],
      options.uiOptions[ui.name],
    ],
  );
  const p = foldMerge(mergeUiParams, defaultDummy, [
    ui.params(),
    options.uiParams["_"],
    options.uiParams[ui.name],
  ]);
  return [o, p];
}

function sourceArgs<
  Params extends BaseSourceParams,
  UserData extends unknown,
>(
  source: BaseSource<Params, UserData> | null,
  options: DduOptions,
  userSource: UserSource | null,
): [SourceOptions, BaseSourceParams] {
  userSource = convertUserString(userSource);

  const o = foldMerge(
    mergeSourceOptions,
    defaultSourceOptions,
    [
      options.sourceOptions["_"],
      source ? options.sourceOptions[source.name] : {},
      userSource?.options,
    ],
  );
  const p = foldMerge(
    mergeSourceParams,
    defaultDummy,
    [
      source?.params(),
      options.sourceParams["_"],
      source ? options.sourceParams[source.name] : {},
      userSource?.params,
    ],
  );
  return [o, p];
}

function filterArgs<
  Params extends BaseFilterParams,
>(
  filter: BaseFilter<Params>,
  options: DduOptions,
  userFilter: UserFilter,
): [FilterOptions, BaseFilterParams] {
  userFilter = convertUserString(userFilter);

  const o = foldMerge(
    mergeFilterOptions,
    defaultFilterOptions,
    [
      options.filterOptions["_"],
      options.filterOptions[filter.name],
      userFilter?.options,
    ],
  );
  const p = foldMerge(
    mergeFilterParams,
    defaultDummy,
    [
      filter?.params(),
      options.filterParams["_"],
      options.filterParams[filter.name],
      userFilter?.params,
    ],
  );
  return [o, p];
}

function kindArgs<
  Params extends BaseKindParams,
>(
  kind: BaseKind<Params>,
  options: DduOptions,
): [KindOptions, BaseKindParams] {
  const o = foldMerge(
    mergeKindOptions,
    defaultKindOptions,
    [
      options.kindOptions["_"],
      options.kindOptions[kind.name],
    ],
  );
  const p = foldMerge(
    mergeKindParams,
    defaultDummy,
    [
      kind?.params(),
      options.kindParams["_"],
      options.kindParams[kind.name],
    ],
  );
  return [o, p];
}

function columnArgs<
  Params extends BaseColumnParams,
>(
  column: BaseColumn<Params>,
  options: DduOptions,
  userColumn: UserColumn,
): [ColumnOptions, BaseColumnParams] {
  userColumn = convertUserString(userColumn);

  const o = foldMerge(
    mergeColumnOptions,
    defaultColumnOptions,
    [
      options.columnOptions["_"],
      options.columnOptions[column.name],
      userColumn?.options,
    ],
  );
  const p = foldMerge(
    mergeColumnParams,
    defaultDummy,
    [
      column?.params(),
      options.columnParams["_"],
      options.columnParams[column.name],
      userColumn?.params,
    ],
  );
  return [o, p];
}

function actionArgs(
  actionName: string,
  options: DduOptions,
  params: BaseActionParams,
): [ActionOptions, BaseActionParams] {
  const o = foldMerge(
    mergeActionOptions,
    defaultActionOptions,
    [
      options.actionOptions["_"],
      options.actionOptions[actionName],
    ],
  );
  const p = foldMerge(mergeActionParams, defaultDummy, [
    options.actionParams["_"],
    options.actionParams[actionName],
    params,
  ]);
  return [o, p];
}

async function initSource<
  Params extends BaseSourceParams,
  UserData extends unknown,
>(
  denops: Denops,
  source: BaseSource<Params, UserData>,
  sourceOptions: SourceOptions,
  sourceParams: Params,
  loader: Loader,
): Promise<void> {
  if (!source) {
    return;
  }

  source.isInitialized = false;
  await source.onInit({
    denops,
    sourceOptions,
    sourceParams,
    loader,
  });
  source.isInitialized = true;
}

async function checkUiOnInit(
  ui: BaseUi<BaseUiParams>,
  denops: Denops,
  uiOptions: UiOptions,
  uiParams: BaseUiParams,
) {
  if (ui.isInitialized) {
    return;
  }

  try {
    await ui.onInit({
      denops,
      uiOptions,
      uiParams,
    });

    ui.isInitialized = true;
  } catch (e: unknown) {
    await errorException(
      denops,
      e,
      `ui: ${ui.name} "onInit()" failed`,
    );
  }
}

async function uiRedraw<
  Params extends BaseUiParams,
>(
  denops: Denops,
  ddu: Ddu,
  lock: Lock<number>,
  ui: BaseUi<Params>,
  uiOptions: UiOptions,
  uiParams: Params,
): Promise<void> {
  // NOTE: Redraw must be locked
  await lock.lock(async () => {
    const options = ddu.getOptions();
    const context = ddu.getContext();
    try {
      if (ddu.shouldStopCurrentContext()) {
        await ddu.uiQuit(denops, ui, uiOptions, uiParams);
        return;
      }

      await ui.redraw({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      // NOTE: ddu may be quitted after redraw
      if (ddu.shouldStopCurrentContext()) {
        await ddu.uiQuit(denops, ui, uiOptions, uiParams);
      }

      await denops.cmd("doautocmd User Ddu:redraw");
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes(" E523: ")) {
        // NOTE: It may be called on invalid state
        // Ignore "E523: Not allowed here" errors
        await denops.call("ddu#_lazy_redraw", options.name);
      } else {
        await errorException(
          denops,
          e,
          `ui: ${ui.name} "redraw()" failed`,
        );
      }
    }
  });
}

async function checkFilterOnInit(
  filter: BaseFilter<BaseFilterParams>,
  denops: Denops,
  filterOptions: FilterOptions,
  filterParams: BaseFilterParams,
) {
  if (filter.isInitialized) {
    return;
  }

  try {
    await filter.onInit({
      denops,
      filterOptions,
      filterParams,
    });

    filter.isInitialized = true;
  } catch (e: unknown) {
    await errorException(
      denops,
      e,
      `filter: ${filter.name} "onInit()" failed`,
    );
  }
}

async function checkColumnOnInit(
  column: BaseColumn<BaseColumnParams>,
  denops: Denops,
  columnOptions: FilterOptions,
  columnParams: BaseColumnParams,
) {
  if (column.isInitialized) {
    return;
  }

  try {
    await column.onInit({
      denops,
      columnOptions,
      columnParams,
    });

    column.isInitialized = true;
  } catch (e: unknown) {
    await errorException(
      denops,
      e,
      `column: ${column.name} "onInit()" failed`,
    );
  }
}

function convertTreePath(treePath: TreePath) {
  return typeof treePath === "string" ? treePath.split(pathsep) : treePath;
}

function convertUserString<T>(user: string | T) {
  return typeof user === "string" ? { name: user } : user;
}

function isParentPath(checkPath: string[], searchPath: string[]) {
  return checkPath !== searchPath &&
    searchPath.join(pathsep).startsWith(checkPath.join(pathsep) + pathsep);
}

Deno.test("sourceArgs", () => {
  const userOptions: DduOptions = {
    ...defaultDduOptions(),
    sources: [],
    sourceOptions: {
      "_": {
        matcherKey: "foo",
        matchers: ["matcher_head"],
      },
      "strength": {
        matcherKey: "bar",
      },
    },
    sourceParams: {
      "_": {
        "by_": "bar",
      },
      "strength": {
        min: 100,
      },
    },
  };
  class S extends BaseSource<{ min: number; max: number }> {
    params() {
      return {
        "min": 0,
        "max": 999,
      };
    }
    gather(
      _args: GatherArguments<{ min: number; max: number }> | Denops,
    ): ReadableStream<Item<Record<string, never>>[]> {
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    }
  }
  const source = new S();
  source.name = "strength";
  const [o, p] = sourceArgs(source, userOptions, null);
  assertEquals(o, {
    ...defaultSourceOptions(),
    matcherKey: "bar",
    matchers: ["matcher_head"],
    converters: [],
    sorters: [],
  });
  assertEquals(p, {
    ...defaultDummy(),
    by_: "bar",
    min: 100,
    max: 999,
  });
});

Deno.test("isParentPath", () => {
  assertEquals(
    true,
    isParentPath("/home".split("/"), "/home/string".split("/")),
  );
  assertEquals(
    true,
    isParentPath(
      "/home/shougo/work/ddu.vim".split("/"),
      "/home/shougo/work/ddu.vim/denops/ddu/deps.ts".split("/"),
    ),
  );
  assertEquals(false, isParentPath("hoge".split("/"), "/home".split("/")));
});
