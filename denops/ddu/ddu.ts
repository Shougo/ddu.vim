import {
  assertEquals,
  basename,
  Denops,
  equal,
  fn,
  Lock,
  pathsep,
} from "./deps.ts";
import {
  ActionFlags,
  ActionHistory,
  BaseActionParams,
  BaseSource,
  BaseSourceParams,
  Clipboard,
  Context,
  DduEvent,
  DduItem,
  DduOptions,
  ExpandItem,
  Item,
  PreviewContext,
  SourceInfo,
  SourceOptions,
  TreePath,
  UserOptions,
  UserSource,
} from "./types.ts";
import {
  defaultContext,
  defaultDduOptions,
  foldMerge,
  mergeDduOptions,
} from "./context.ts";
import { defaultSourceOptions } from "./base/source.ts";
import { Loader } from "./loader.ts";
import { convertUserString, printError, treePath2Filename } from "./utils.ts";
import {
  AvailableSourceInfo,
  GatherState,
  GatherStateAbortable,
  isRefreshTarget,
} from "./state.ts";
import {
  callColumns,
  callFilters,
  callOnRefreshItemsHooks,
  getColumn,
  getFilter,
  getItemAction,
  getPreviewer,
  getSource,
  getUi,
  initSource,
  sourceArgs,
  uiQuit,
  uiRedraw,
  uiSearchItem,
} from "./ext.ts";

type RedrawOptions = {
  /**
   * NOTE: Set restoreItemState to true if redraw without regather because
   * item's states reset to gathered.
   */
  restoreItemState?: boolean;
  signal?: AbortSignal;
};

export class Ddu {
  #loader: Loader;
  readonly #gatherStates = new Map<number, GatherState>();
  #input = "";
  #context: Context = defaultContext();
  #options: DduOptions = defaultDduOptions();
  #userOptions: UserOptions = {};
  #initialized = false;
  #quitted = false;
  #aborter = new AbortController() as
    & Omit<AbortController, "abort">
    & GatherStateAbortable;
  readonly #uiRedrawLock = new Lock(0);
  #waitRedrawComplete?: Promise<void>;
  #scheduledRedrawOptions?: Required<RedrawOptions>;
  #startTime = 0;
  #searchPath: TreePath = "";
  #items: DduItem[] = [];
  readonly #expandedItems: Map<string, DduItem> = new Map();

  constructor(loader: Loader) {
    this.#loader = loader;
  }

  async start(
    denops: Denops,
    context: Context,
    options: DduOptions,
    userOptions: UserOptions,
  ): Promise<unknown> {
    const prevContext = { ...this.#context };
    const { signal: prevSignal } = this.#aborter;

    this.#context = context;
    this.#userOptions = userOptions;

    const resume =
      (userOptions?.resume === undefined && this.#options?.resume) ||
      userOptions?.resume;

    const uiChanged = userOptions?.ui && this.#options.ui !== "" &&
      userOptions?.ui !== this.#options.ui;

    if (uiChanged) {
      // Quit current UI
      await uiQuit(
        denops,
        this.#loader,
        this.#context,
        this.#options,
      );
      this.quit();
    }

    const checkToggle = this.#initialized && !prevSignal.aborted &&
      !userOptions?.refresh;

    if (
      this.#initialized && resume &&
      prevContext.done && this.#context.cwd === prevContext.cwd &&
      (!userOptions?.sources ||
        equal(userOptions.sources, this.#options.sources))
    ) {
      // NOTE: sources must not overwrite
      userOptions.sources = this.#options.sources;

      this.updateOptions(userOptions);

      // Set input
      if (userOptions?.input !== undefined) {
        await this.setInput(denops, userOptions.input as string);
      } else if (prevContext.input !== "") {
        await this.setInput(denops, prevContext.input);
      }

      // Restore
      this.#context.path = prevContext.path;
      this.#context.maxItems = prevContext.maxItems;

      const [ui, uiOptions, _] = await getUi(
        denops,
        this.#loader,
        this.#options,
      );
      if (!ui) {
        return;
      }

      if (checkToggle && uiOptions.toggle) {
        await uiQuit(
          denops,
          this.#loader,
          this.#context,
          this.#options,
        );
        this.quit();
        return;
      }

      if (userOptions.searchPath) {
        // Apply only defined by new options
        this.#searchPath = userOptions.searchPath as string;
      }

      if (!this.#options?.refresh) {
        this.#resetQuitted();

        if (this.#searchPath) {
          // Redraw only without regather items.
          return this.redraw(denops, { restoreItemState: true });
        }

        // UI Redraw only
        // NOTE: Enable done to redraw UI properly
        this.#context.done = true;
        await this.uiRedraw(
          denops,
          { signal: this.#aborter.signal },
        );
        this.#context.doneUi = true;
        return;
      }

      await this.cancelToRefresh();
    } else {
      await this.cancelToRefresh();

      this.#expandedItems.clear();
      this.#options = options;
      await this.setInput(denops, this.#options.input);
    }

    if (this.#options.searchPath.length > 0) {
      this.#searchPath = this.#options.searchPath;
    }

    // NOTE: UI must be reset.
    const [ui, uiOptions, _] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );

    if (checkToggle && ui && uiOptions.toggle) {
      await uiQuit(
        denops,
        this.#loader,
        this.#context,
        this.#options,
      );
      this.quit();
      return;
    }

    if (ui) {
      ui.isInitialized = false;
    }

    this.#initialized = false;
    this.#resetQuitted();
    this.#startTime = Date.now();

    // NOTE: Get the signal after the aborter is reset.
    const { signal } = this.#aborter;

    // Gather items asynchronously.
    const [availableSources, sourcesInitialized] = this
      .#createAvailableSourceStream(denops, { initialize: true })
      .tee();
    const [gatherStates] = availableSources
      .pipeThrough(this.#createGatherStateTransformer(denops, signal))
      .tee();

    // Wait until initialized all sources. Source onInit() must be called before UI.
    await Array.fromAsync(sourcesInitialized);

    // UI should load before refresh.
    // NOTE: If UI is blocked until refresh, user input will break UI.
    await this.uiRedraw(denops, { signal });

    await this.#refreshSources(denops, gatherStates, { signal });

    this.#initialized = true;
  }

  async restart(
    denops: Denops,
    userOptions: UserOptions,
  ): Promise<void> {
    // Quit current UI
    await uiQuit(
      denops,
      this.#loader,
      this.#context,
      this.#options,
    );
    this.quit();

    // Disable resume
    userOptions.resume = false;

    // Restart
    this.updateOptions(userOptions);
    await this.start(
      denops,
      this.#context,
      this.#options,
      userOptions,
    );
  }

  async refresh(
    denops: Denops,
    refreshIndexes: number[] = [],
  ): Promise<void> {
    this.#startTime = Date.now();
    this.#context.done = false;

    await this.cancelToRefresh(refreshIndexes);

    // NOTE: Get the signal after the aborter is reset.
    const { signal } = this.#aborter;

    // Initialize UI window
    if (!this.#options.sync) {
      /* no await */ this.redraw(denops);
    }

    const [gatherStates] = this
      .#createAvailableSourceStream(denops, { indexes: refreshIndexes })
      .pipeThrough(this.#createGatherStateTransformer(denops, signal))
      .tee();

    await this.#refreshSources(denops, gatherStates);
  }

  #createAvailableSourceStream(
    denops: Denops,
    options?: {
      initialize?: boolean;
      indexes?: number[];
    },
  ): ReadableStream<AvailableSourceInfo> {
    const { initialize = false, indexes = [] } = options ?? {};

    return new ReadableStream({
      start: async (controller) => {
        await Promise.all(
          this.#options.sources
            .map((source) => convertUserString(source))
            .map(async (userSource, sourceIndex) => {
              if (indexes.length > 0 && !indexes.includes(sourceIndex)) {
                return;
              }

              const [source, sourceOptions, sourceParams] = await getSource(
                denops,
                this.#loader,
                this.#options,
                userSource.name,
                userSource,
              );
              if (source == null) {
                return;
              }

              if (initialize) {
                await initSource(
                  denops,
                  source,
                  sourceOptions,
                  sourceParams,
                  this.#loader,
                );
              }

              controller.enqueue({
                sourceIndex,
                source,
                sourceOptions,
                sourceParams,
              });
            }),
        );
        controller.close();
      },
    });
  }

  #createGatherStateTransformer(
    denops: Denops,
    signal: AbortSignal,
  ): TransformStream<AvailableSourceInfo, GatherState> {
    return new TransformStream({
      transform: (sourceInfo, controller) => {
        const { sourceIndex, source, sourceOptions, sourceParams } = sourceInfo;

        const state = this.#gatherItems(
          denops,
          sourceIndex,
          source,
          sourceOptions,
          sourceParams,
          this.#loader,
          0,
          { signal },
        );
        this.#gatherStates.set(sourceIndex, state);

        controller.enqueue(state);
      },
    });
  }

  async #refreshSources(
    denops: Denops,
    gatherStates: ReadableStream<GatherState>,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const { signal = this.#aborter.signal } = opts ?? {};
    const refreshErrorHandler = new AbortController();
    const refreshedSources: Promise<void>[] = [];

    await gatherStates.pipeTo(
      new WritableStream({
        write: (state) => {
          refreshedSources.push(
            this.#refreshItems(denops, state).catch((e) => {
              refreshErrorHandler.abort(e);
            }),
          );
        },
        close: async () => {
          await Promise.all(refreshedSources);
        },
      }),
      { signal: refreshErrorHandler.signal },
    );

    if (!this.#context.done) {
      await this.redraw(denops, { signal });
    } else {
      await this.#waitRedrawComplete;
    }
  }

  async #refreshItems(denops: Denops, state: GatherState): Promise<void> {
    const { sourceInfo: { sourceOptions }, itemsStream, signal } = state;

    await callOnRefreshItemsHooks(
      denops,
      this.#loader,
      this.#options,
      sourceOptions,
    );

    // Get path option or context path directory instead if it is empty.
    const path = sourceOptions.path.length > 0
      ? sourceOptions.path
      : this.#context.path;

    for await (const newItems of itemsStream) {
      if (!equal(path, this.#context.path)) {
        if (this.#context.path.length > 0) {
          this.#context.pathHistories.push(this.#context.path);
        }
        this.#context.path = path;
      }

      if (!this.#options.sync && newItems.length > 0) {
        /* no await */ this.redraw(denops, { signal });
      }
    }
  }

  #newDduItem<
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

    const dduItem = {
      ...item,
      kind: item.kind ?? source.kind,
      matcherKey,
      __sourceIndex: sourceIndex,
      __sourceName: source.name,
      __level: item.level ?? level ?? 0,
      __expanded: false,
      __columnTexts: {},
      __groupedPath: "",
    };
    if (item.isExpanded) {
      this.#setExpanded(dduItem);
      dduItem.__expanded = this.#isExpanded(dduItem);
    }

    return dduItem;
  }

  #gatherItems<
    Params extends BaseSourceParams,
    UserData extends unknown,
  >(
    denops: Denops,
    sourceIndex: number,
    source: BaseSource<Params, UserData>,
    sourceOptions: SourceOptions,
    sourceParams: Params,
    loader: Loader,
    itemLevel: number,
    opts?: {
      parent?: DduItem;
      signal?: AbortSignal;
    },
  ): GatherState<Params, UserData> {
    const { parent, signal = this.#aborter.signal } = opts ?? {};

    const itemTransformer = new TransformStream<Item[], DduItem[]>({
      transform: (chunk, controller) => {
        const newItems = chunk.map((item: Item) =>
          this.#newDduItem(
            sourceIndex,
            source,
            sourceOptions,
            item,
            itemLevel,
          )
        );
        controller.enqueue(newItems);
      },
    });

    const state = new GatherState(
      {
        sourceIndex,
        source,
        sourceOptions,
        sourceParams,
      },
      itemTransformer.readable,
      { signal },
    );

    // Process from stream generation to termination.
    (async () => {
      try {
        // No `await` before here, to run `source.gather()` synchronously.
        const itemsStream = source.gather({
          denops,
          context: this.#context,
          options: this.#options,
          sourceOptions,
          sourceParams,
          input: this.#input,
          parent,
          loader,
        });

        // Wait until the stream closes.
        await itemsStream.pipeTo(itemTransformer.writable);
      } catch (e: unknown) {
        if (state.signal.aborted && e === state.signal.reason) {
          // Aborted by signal, so do nothing.
        } else {
          // Show error message
          printError(denops, `source: ${source.name} "gather()" failed`, e);
        }
      }
    })();

    return state;
  }

  redraw(
    denops: Denops,
    opts?: RedrawOptions,
  ): Promise<unknown> {
    const newOpts = {
      restoreItemState: false,
      signal: this.#aborter.signal,
      ...opts,
    };

    if (this.#waitRedrawComplete) {
      // Already redrawing, so adding to schedule
      const prevOpts: RedrawOptions = this.#scheduledRedrawOptions ?? {};
      this.#scheduledRedrawOptions = {
        // Override with true
        restoreItemState: prevOpts.restoreItemState || newOpts.restoreItemState,
        // Merge all signals
        signal: prevOpts.signal && newOpts.signal !== prevOpts.signal
          ? AbortSignal.any([newOpts.signal, prevOpts.signal])
          : prevOpts.signal ?? newOpts.signal,
      };
    } else {
      // Start redraw
      const { resolve, reject } = { promise: this.#waitRedrawComplete } =
        Promise.withResolvers<void>();
      this.#scheduledRedrawOptions = newOpts;

      (async () => {
        try {
          while (this.#scheduledRedrawOptions) {
            const nextOpts = this.#scheduledRedrawOptions;
            this.#scheduledRedrawOptions = undefined;
            await this.#redrawInternal(denops, nextOpts);
          }
          // All schedules completed
          this.#waitRedrawComplete = undefined;
          resolve();
        } catch (e: unknown) {
          reject(e);
        }
      })();
    }

    return this.#waitRedrawComplete;
  }

  async #redrawInternal(
    denops: Denops,
    { restoreItemState, signal }: Required<RedrawOptions>,
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    // Update current input
    this.#context.doneUi = false;
    this.#context.input = this.#input;
    this.#context.maxItems = 0;

    const filterResults = (await Promise.all(
      this.#options.sources
        .map((source) => convertUserString(source))
        .map(async (userSource, sourceIndex) => {
          const [source, sourceOptions, _] = await getSource(
            denops,
            this.#loader,
            this.#options,
            userSource.name,
            userSource,
          );
          if (!source) {
            return;
          }

          const sourceInfo: SourceInfo = {
            name: userSource.name,
            index: sourceIndex,
            path: sourceOptions.path,
            kind: source.kind ?? "base",
          };

          const [done, maxItems, items] = await this.#filterItems(
            denops,
            userSource,
            sourceIndex,
            this.#input,
          );

          if (restoreItemState) {
            for (const item of items) {
              if (item.treePath) {
                item.__expanded = this.#isExpanded(item);
              }
            }
          }

          return {
            sourceInfo,
            done,
            maxItems,
            items,
          };
        }),
    )).filter((result): result is NonNullable<typeof result> => result != null);

    const sources = filterResults.map(({ sourceInfo }) => sourceInfo);
    let allItems = filterResults.flatMap(({ items }) => items);
    this.#context.done = filterResults.every(({ done }) => done);
    this.#context.maxItems = filterResults.reduce(
      (x, { maxItems }) => x + maxItems,
      0,
    );

    // Post filters
    allItems = await callFilters(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      defaultSourceOptions(),
      this.#options.postFilters,
      this.#input,
      allItems,
    );

    if (this.#options.unique) {
      // Unique all items

      const words = new Set<string>();
      allItems = allItems.reduce((items: DduItem[], item) => {
        if (!words.has(item.word)) {
          words.add(item.word);
          items.push(item);
        }
        return items;
      }, []);
      this.#context.maxItems = allItems.length;
    }

    this.#items = allItems;

    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (!ui || signal.aborted) {
      return;
    }

    await ui.refreshItems({
      denops,
      context: this.#context,
      options: this.#options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      sources: sources,
      items: allItems,
    });

    const searchPath = this.#searchPath;

    // Prevent infinite loop
    this.#searchPath = "";

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
              isGrouped: false,
              signal,
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
            isGrouped: false,
            signal,
          },
        );
      }
    }));

    if (this.#context.done && this.#options.profile) {
      await printError(
        denops,
        `Refresh all items: ${Date.now() - this.#startTime} ms`,
      );
    }

    await this.uiRedraw(denops, { signal });
    if (searchTargetItem && !signal.aborted) {
      await uiSearchItem(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        searchTargetItem,
      );
    }

    this.#context.doneUi = this.#context.done;
  }

  async uiRedraw(
    denops: Denops,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const { signal = this.#aborter.signal } = opts ?? {};

    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (!ui || signal.aborted) {
      return;
    }

    await uiRedraw(
      denops,
      this.#uiRedrawLock,
      this.#context,
      this.#options,
      ui,
      uiOptions,
      uiParams,
      signal,
    );
  }

  async onEvent(
    denops: Denops,
    event: DduEvent,
  ): Promise<void> {
    for (
      const userSource of this.#options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, sourceParams] = await getSource(
        denops,
        this.#loader,
        this.#options,
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

    if (event === "close" || event === "cancel") {
      // Quit event
      await uiQuit(
        denops,
        this.#loader,
        this.#context,
        this.#options,
      );
    }
  }

  quit() {
    // NOTE: quitted flag must be called after ui.quit().
    this.#quitted = true;
    this.#aborter.abort({ reason: "quit" });
    this.#context.done = true;
  }

  #resetQuitted() {
    this.#quitted = false;
    this.#resetAborter();
  }

  async cancelToRefresh(
    refreshIndexes: number[] = [],
  ): Promise<void> {
    this.#aborter.abort({ reason: "cancelToRefresh", refreshIndexes });

    await Promise.all(
      [...this.#gatherStates]
        .map(([sourceIndex, state]) => {
          if (isRefreshTarget(sourceIndex, refreshIndexes)) {
            this.#gatherStates.delete(sourceIndex);
            return state.waitDone;
          }
        }),
    );

    this.#resetAborter();
  }

  #resetAborter() {
    if (!this.#quitted && this.#aborter.signal.aborted) {
      this.#aborter = new AbortController();
      for (const state of this.#gatherStates.values()) {
        state.resetSignal(this.#aborter.signal);
      }
    }
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    actionParams: BaseActionParams,
  ): Promise<void> {
    if (await fn.getcmdwintype(denops) !== "") {
      // Skip when Command line window
      return;
    }

    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
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
      await printError(denops, `Not found UI action: ${actionName}`);
      return;
    }

    let ret;
    if (typeof action === "string") {
      ret = await denops.call(
        "denops#callback#call",
        action,
        {
          context: this.#context,
          options: this.#options,
          uiOptions,
          uiParams,
          actionParams,
        },
      ) as ActionFlags;
    } else {
      ret = await action({
        denops,
        ddu: this,
        context: this.#context,
        options: this.#options,
        uiOptions,
        uiParams,
        actionParams,
        getPreviewer: (
          denops: Denops,
          item: DduItem,
          actionParams: BaseActionParams,
          previewContext: PreviewContext,
        ) =>
          getPreviewer(
            denops,
            this.#loader,
            this.#options,
            item,
            actionParams,
            previewContext,
          ),
      });
    }

    if (ui.onAfterAction) {
      await ui.onAfterAction({
        denops,
        uiOptions,
        uiParams,
      });
    }

    // NOTE: Get the signal after the UI action finishes.
    const { signal } = this.#aborter;

    const flags = typeof ret === "number" ? ret : ActionFlags.None;

    if (flags & ActionFlags.RefreshItems) {
      await this.refresh(denops);
    } else if (flags & ActionFlags.Redraw) {
      await uiRedraw(
        denops,
        this.#uiRedrawLock,
        this.#context,
        this.#options,
        ui,
        uiOptions,
        uiParams,
        signal,
      );
    }

    // NOTE: :redraw is needed for command line
    await denops.cmd("redraw");
  }

  async itemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    userActionParams: BaseActionParams,
    clipboard: Clipboard,
    actionHistory: ActionHistory,
  ): Promise<void> {
    const itemAction = await getItemAction(
      denops,
      this.#loader,
      this.#options,
      actionName,
      items,
      userActionParams,
    );
    if (!itemAction) {
      return;
    }

    if (itemAction.actionOptions.quit) {
      // Quit UI before action
      await uiQuit(
        denops,
        this.#loader,
        this.#context,
        this.#options,
      );
    }

    const prevPath = itemAction.sourceOptions.path;
    let ret;
    if (typeof itemAction.action === "string") {
      ret = await denops.call(
        "denops#callback#call",
        itemAction.action,
        {
          context: this.#context,
          options: this.#options,
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
        context: this.#context,
        options: this.#options,
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
        itemAction.userSource.options = {};
      }
      itemAction.userSource.options.path = itemAction.sourceOptions.path;
      if (this.#context.path.length > 0) {
        this.#context.pathHistories.push(this.#context.path);
      }

      // Overwrite userSource
      this.#options.sources[itemAction.sourceIndex] = itemAction.userSource;

      this.#context.path = itemAction.sourceOptions.path;

      // Clear input when path is changed
      await this.setInput(denops, "");
    }

    if (searchPath.length > 0) {
      this.#searchPath = searchPath;
    }

    const winId = await fn.win_getid(denops);

    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );

    if (flags & ActionFlags.RefreshItems) {
      // Restore quitted flag before refresh and redraw
      this.#resetQuitted();

      await this.refresh(denops);

      if (searchPath.length <= 0) {
        // NOTE: If searchPath exists, expandItems() is executed.
        await this.restoreTree(denops);
      }
    } else if (uiOptions.persist || flags & ActionFlags.Persist) {
      // Restore quitted flag before refresh and redraw
      this.#resetQuitted();

      // NOTE: Get the signal after the aborter is reset.
      const { signal } = this.#aborter;

      if (ui) {
        await uiRedraw(
          denops,
          this.#uiRedrawLock,
          this.#context,
          this.#options,
          ui,
          uiOptions,
          uiParams,
          signal,
        );
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
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const { signal = this.#aborter.signal } = opts ?? {};
    for (const item of items.sort((a, b) => a.item.__level - b.item.__level)) {
      const maxLevel = item.maxLevel && item.maxLevel < 0
        ? -1
        : item.item.__level + (item.maxLevel ?? 0);
      await this.expandItem(
        denops,
        item.item,
        {
          search: item.search,
          maxLevel,
          preventRedraw: true,
          isGrouped: item.isGrouped ?? false,
          isInTree: item.isInTree ?? false,
          signal,
        },
      );
    }

    await this.uiRedraw(denops, { signal });
  }

  async expandItem(
    denops: Denops,
    parent: DduItem,
    options: {
      /**
       * If specified, expand recursively to find it path.
       * Otherwise, Expand recursively to the maxLevel.
       */
      search?: TreePath;
      maxLevel?: number;
      preventRedraw?: boolean;
      isGrouped?: boolean;
      isInTree?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<DduItem /* searchedItem */ | undefined> {
    const {
      search,
      maxLevel = -1,
      preventRedraw = false,
      signal = this.#aborter.signal,
    } = options;

    if (
      parent.__level < 0 || !parent.isTree || !parent.treePath ||
      signal.aborted
    ) {
      return;
    }

    const sourceIndex = parent.__sourceIndex;
    const source = this.#loader.getSource(
      this.#options.name,
      parent.__sourceName,
    );
    if (source == null) {
      return;
    }
    const state = this.#gatherStates.get(sourceIndex);
    if (state == null) {
      return;
    }

    const [sourceOptions, sourceParams] = sourceArgs(
      source,
      this.#options,
      this.#options.sources[sourceIndex],
    );

    this.#setExpanded(parent);
    parent.__expanded = true;

    // Set path
    const savePath = this.#context.path;
    sourceOptions.path = parent.treePath ?? parent.word;
    this.#context.path = sourceOptions.path;

    let children: DduItem[] = [];
    let isGrouped = false;

    try {
      const state = this.#gatherItems(
        denops,
        sourceIndex,
        source,
        sourceOptions,
        sourceParams,
        this.#loader,
        parent.__level + 1,
        { parent, signal },
      );

      await state.readAll();
      children = [...state.items];

      if (signal.aborted) {
        return;
      }

      if (options.isGrouped && children.length === 1 && children[0].isTree) {
        children[0].word = `${parent.word ?? ""}${children[0].word ?? ""}`;
        children[0].__level = parent.__level;
        children[0].__groupedPath = parent.word;
        isGrouped = true;
      }

      // NOTE: parent must be applied columns.
      const columnItems = [parent].concat(children);
      await callColumns(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions.columns,
        columnItems,
        state.items.concat(columnItems),
      );

      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);

      // NOTE: Apply filter for parent item to update highlights and "display".
      const items = await callFilters(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions,
        filters,
        this.#input,
        [parent],
      );
      if (items.length > 0) {
        parent.display = items[0].display;
      }

      children = await callFilters(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions,
        filters,
        this.#input,
        children,
      );
      this.#context.maxItems += children.length;
    } finally {
      // Restore path
      this.#context.path = savePath;
    }

    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (ui && !signal.aborted) {
      await ui.expandItem({
        denops,
        context: this.#context,
        options: this.#options,
        uiOptions,
        uiParams,
        parent,
        children,
        isGrouped,
      });
    }

    let searchedItem: DduItem | undefined;

    if (maxLevel < 0 || parent.__level < maxLevel) {
      const expandTargetChildren = children.filter(
        search != null
          // Expand recursively to find the `search` path
          ? (child) =>
            child.__expanded ||
            child.isTree && child.treePath &&
              isParentPath(
                convertTreePath(child.treePath),
                convertTreePath(search),
              )
          // Expand recursively to the maxLevel
          : (child) =>
            child.__expanded ||
            child.isTree && child.treePath &&
              // NOTE: Skip hidden directory
              !basename(treePath2Filename(child.treePath)).startsWith("."),
      );

      if (expandTargetChildren.length > 0) {
        // Expand is not completed yet.
        const childOptions = {
          ...options,
          preventRedraw: true,
          signal,
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
        await this.collapseItems(denops, expandedChildren, {
          preventRedraw: true,
          signal,
        });
      }
    }

    if (
      search &&
      !searchedItem && parent.treePath &&
      isParentPath(
        convertTreePath(parent.treePath),
        convertTreePath(search),
      )
    ) {
      searchedItem = children.find((item) =>
        search === item.treePath ?? item.word
      );
    }

    if (ui && !signal.aborted && !preventRedraw) {
      await uiRedraw(
        denops,
        this.#uiRedrawLock,
        this.#context,
        this.#options,
        ui,
        uiOptions,
        uiParams,
        signal,
      );

      if (!signal.aborted) {
        await uiSearchItem(
          denops,
          this.#loader,
          this.#context,
          this.#options,
          searchedItem ?? parent,
        );
      }
    }

    if (options.isInTree && children.length > 0 && !isGrouped) {
      // NOTE: To enter the expanded directory, execute "cursorNext" action
      await this.uiAction(
        denops,
        "cursorNext",
        {},
      );
    }

    return searchedItem;
  }

  async collapseItems(
    denops: Denops,
    items: DduItem[],
    opts?: {
      preventRedraw?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const { preventRedraw, signal = this.#aborter.signal } = opts ?? {};

    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (!ui || signal.aborted) {
      return;
    }

    for (const item of items) {
      if (!item.treePath) {
        continue;
      }
      const sourceIndex = item.__sourceIndex;
      const source = this.#loader.getSource(
        this.#options.name,
        item.__sourceName,
      );
      if (source == null) {
        continue;
      }
      const [sourceOptions, _] = sourceArgs(
        source,
        this.#options,
        this.#options.sources[sourceIndex],
      );
      const state = this.#gatherStates.get(sourceIndex);
      if (state == null) {
        continue;
      }

      this.#setUnexpanded(item);
      item.__expanded = false;

      const columnItems = [item];
      await callColumns(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions.columns,
        columnItems,
        state.items.concat(columnItems),
      );

      // NOTE: Apply filter for parent item to update highlights and "display".
      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);
      const items = await callFilters(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions,
        filters,
        this.#input,
        [item],
      );
      if (items.length > 0) {
        item.display = items[0].display;
      }

      if (signal.aborted) {
        return;
      }

      const collapsed = await ui.collapseItem({
        denops,
        context: this.#context,
        options: this.#options,
        uiOptions,
        uiParams,
        item,
      });

      if (collapsed) {
        this.#context.maxItems -= collapsed;
      }
    }

    if (!preventRedraw && !signal.aborted) {
      await uiRedraw(
        denops,
        this.#uiRedrawLock,
        this.#context,
        this.#options,
        ui,
        uiOptions,
        uiParams,
        signal,
      );

      const searchItem = items.at(-1);

      if (searchItem && !signal.aborted) {
        await uiSearchItem(
          denops,
          this.#loader,
          this.#context,
          this.#options,
          searchItem,
        );
      }
    }
  }

  async uiVisible(
    denops: Denops,
    tabNr: number,
  ): Promise<boolean> {
    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (!ui?.visible || this.#quitted) {
      return false;
    }

    return await ui.visible({
      denops,
      context: this.#context,
      options: this.#options,
      uiOptions,
      uiParams,
      tabNr,
    });
  }

  async uiWinids(
    denops: Denops,
  ): Promise<number[]> {
    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (!ui?.winIds || this.#quitted) {
      return [];
    }

    return await ui.winIds({
      denops,
      context: this.#context,
      options: this.#options,
      uiOptions,
      uiParams,
    });
  }

  async setInput(denops: Denops, input: string) {
    if (this.#options.expandInput) {
      input = await fn.expand(denops, input) as string;
    }
    this.#input = input;
    this.#context.input = input;
  }

  getContext() {
    return this.#context;
  }

  getOptions() {
    return this.#options;
  }

  getUserOptions() {
    return this.#userOptions;
  }

  async getCurrentOptions(denops: Denops): Promise<DduOptions> {
    // NOTE: Cannot use structuredClone().
    // It may contain functions.
    const ret = Object.assign(this.#options);

    // Merge UI options
    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (ui) {
      ret.uiOptions[ui.name] = uiOptions;
      ret.uiParams[ui.name] = uiParams;
    }

    // Merge source options
    for (
      const userSource of this.#options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, sourceParams] = await getSource(
        denops,
        this.#loader,
        this.#options,
        userSource.name,
        userSource,
      );

      if (!source) {
        continue;
      }

      ret.sourceOptions[source.name] = sourceOptions;
      ret.sourceParams[source.name] = sourceParams;

      // Merge filter options
      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);
      for (
        const userFilter of filters.map((filter) => convertUserString(filter))
      ) {
        const [filter, filterOptions, filterParams] = await getFilter(
          denops,
          this.#loader,
          this.#options,
          userFilter,
        );
        if (!filter) {
          continue;
        }

        ret.filterOptions[filter.name] = filterOptions;
        ret.filterParams[filter.name] = filterParams;
      }

      // Merge column options
      for (
        const userColumn of sourceOptions.columns.map((column) =>
          convertUserString(column)
        )
      ) {
        const [column, columnOptions, columnParams] = await getColumn(
          denops,
          this.#loader,
          this.#options,
          userColumn,
        );
        if (!column) {
          continue;
        }

        ret.columnOptions[column.name] = columnOptions;
        ret.columnParams[column.name] = columnParams;
      }
    }

    return ret;
  }

  getSourceArgs() {
    return this.#options.sources.map((userSource) =>
      sourceArgs(
        this.#loader.getSource(
          this.#options.name,
          convertUserString(userSource).name,
        ),
        this.#options,
        userSource,
      )
    );
  }

  getItems() {
    return this.#items;
  }

  updateOptions(userOptions: UserOptions) {
    this.#options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.#options,
      userOptions,
    ]);
  }

  async checkUpdated(denops: Denops): Promise<boolean> {
    for (
      const userSource of this.#options.sources.map((source) =>
        convertUserString(source)
      )
    ) {
      const [source, sourceOptions, sourceParams] = await getSource(
        denops,
        this.#loader,
        this.#options,
        userSource.name,
        userSource,
      );

      if (!source || !source.checkUpdated) {
        continue;
      }

      const updated = await source.checkUpdated({
        denops,
        context: this.#context,
        options: this.#options,
        sourceOptions,
        sourceParams,
      });

      if (updated) {
        return updated;
      }
    }

    return false;
  }

  async restoreTree(
    denops: Denops,
  ): Promise<void> {
    // NOTE: Check expandedItems are exists in this.#items
    const checkItems: Map<string, DduItem> = new Map();
    for (const item of this.#items) {
      checkItems.set(item2Key(item), item);
    }

    const restoreItems = [...this.#expandedItems.values()].filter((item) =>
      checkItems.has(item2Key(item))
    ).map((item) => ({ item }));

    if (restoreItems.length === 0) {
      return;
    }

    await this.expandItems(denops, restoreItems);
  }

  async #filterItems(
    denops: Denops,
    userSource: UserSource,
    sourceIndex: number,
    input: string,
  ): Promise<[boolean, number, DduItem[]]> {
    userSource = convertUserString(userSource);

    const [source, sourceOptions, _] = await getSource(
      denops,
      this.#loader,
      this.#options,
      userSource.name,
      userSource,
    );

    const state = this.#gatherStates.get(sourceIndex);
    if (!state || !source) {
      return [false, 0, []];
    }

    // NOTE: Use deepcopy.  Because of filters may break original items.
    let items = structuredClone(state.items) as DduItem[];
    const allItems = items.length;

    items = await callFilters(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      sourceOptions,
      sourceOptions.matchers.concat(sourceOptions.sorters),
      input,
      items,
    );

    // Truncate before converters
    if (items.length > sourceOptions.maxItems) {
      items = items.slice(0, sourceOptions.maxItems);
    }

    // NOTE: Call columns before converters after matchers and sorters
    await callColumns(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      sourceOptions.columns,
      items,
      items,
    );

    items = await callFilters(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      sourceOptions,
      sourceOptions.converters,
      input,
      items,
    );

    return [state.isDone, allItems, items];
  }

  #isExpanded(
    item: DduItem,
  ): boolean {
    return Boolean(
      item.treePath && this.#expandedItems.has(item2Key(item)),
    );
  }

  #setExpanded(
    item: DduItem,
  ): void {
    if (item.treePath) {
      this.#expandedItems.set(item2Key(item), item);
    }
  }

  #setUnexpanded(
    item: DduItem,
  ): void {
    if (!item.treePath) {
      return;
    }

    const key = item2Key(item);
    const itemTreePath = convertTreePath(item.treePath);
    [...this.#expandedItems.values()].forEach((v) => {
      const k = item2Key(v);
      if (
        key === k || isParentPath(itemTreePath, convertTreePath(v.treePath))
      ) {
        this.#expandedItems.delete(k);
      }
    });
  }
}

function convertTreePath(treePath?: TreePath): string[] {
  return typeof treePath === "string"
    ? treePath.split(pathsep)
    : !treePath
    ? []
    : treePath;
}

function isParentPath(checkPath: string[], searchPath: string[]) {
  return checkPath !== searchPath &&
    searchPath.join(pathsep).startsWith(checkPath.join(pathsep) + pathsep);
}

function item2Key(item: DduItem) {
  const treePath = typeof item.treePath === "string"
    ? item.treePath
    : item.treePath
    ? item.treePath.join(pathsep)
    : item.word;
  return `${item.__sourceIndex}${item.__sourceName}:${treePath}`;
}

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
