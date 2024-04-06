import {
  assertEquals,
  basename,
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
  ActionName,
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
  ItemAction,
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

// deno-lint-ignore no-explicit-any
type AnySource = BaseSource<any>;

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
  signal?: AbortSignal;
};

type ItemActionInfo = {
  userSource: UserSource;
  sourceIndex: number;
  sourceOptions: SourceOptions;
  sourceParams: BaseSourceParams;
  kindOptions: KindOptions;
  kindParams: BaseKindParams;
  actionOptions: ActionOptions;
  actionParams: BaseActionParams;
  action: string | Action<BaseActionParams>;
};

type AvailableSourceInfo<
  Params extends BaseSourceParams = BaseSourceParams,
  UserData extends unknown = unknown,
> = {
  sourceIndex: number;
  source: BaseSource<Params, UserData>;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

type GatherStateAbortReason =
  | {
    reason: "quit";
  }
  | {
    reason: "cancelToRefresh";
    refreshIndexes: number[];
  };

type GatherStateAbortable = {
  abort(reason: GatherStateAbortReason): void;
};

class GatherState<
  Params extends BaseSourceParams = BaseSourceParams,
  UserData extends unknown = unknown,
> implements GatherStateAbortable {
  readonly sourceInfo: AvailableSourceInfo<Params, UserData>;
  readonly itemsStream: ReadableStream<DduItem[]>;
  #items: DduItem[] = [];
  #isDone = false;
  #waitDone = Promise.withResolvers<void>();
  #aborter = new AbortController();

  constructor(
    sourceInfo: AvailableSourceInfo<Params, UserData>,
    itemsStream: ReadableStream<DduItem[]>,
    options?: {
      signal?: AbortSignal;
    },
  ) {
    const { signal: parentSignal } = options ?? {};

    // Chain abort signals.
    if (parentSignal) {
      const abortIfMatch = () => {
        const reason = (parentSignal.reason ?? {}) as GatherStateAbortReason;
        if (
          reason.reason !== "cancelToRefresh" ||
          reason.refreshIndexes.length === 0 ||
          reason.refreshIndexes.includes(sourceInfo.sourceIndex)
        ) {
          this.#aborter.abort(parentSignal.reason);
        }
      };

      if (parentSignal.aborted) {
        abortIfMatch();
      } else {
        parentSignal.addEventListener("abort", () => abortIfMatch(), {
          signal: this.#aborter.signal,
        });
      }
    }

    this.sourceInfo = sourceInfo;

    const appendStream = new TransformStream<DduItem[], DduItem[]>({
      transform: (newItems, controller) => {
        this.#items = this.#items.concat(newItems);
        controller.enqueue(newItems);
      },
    });
    itemsStream
      .pipeTo(appendStream.writable, {
        signal: this.#aborter.signal,
        // Do not abort output stream.
        preventAbort: true,
      })
      .catch((reason) => {
        appendStream.writable.close().catch(() => {
          // Prevent errors if already closed.
        });
      })
      .finally(() => {
        this.#isDone = true;
        this.#waitDone.resolve();
      });
    this.itemsStream = appendStream.readable;
  }

  get items(): readonly DduItem[] {
    return this.#items;
  }

  get isDone(): boolean {
    return this.#isDone;
  }

  get waitDone(): Promise<void> {
    return this.#waitDone.promise;
  }

  get signal(): AbortSignal {
    return this.#aborter.signal;
  }

  abort(reason: GatherStateAbortReason): void {
    this.#aborter.abort(reason);
  }

  async readAll(): Promise<void> {
    if (this.itemsStream != null) {
      await Array.fromAsync(this.itemsStream);
    }
  }
}

export class Ddu {
  #loader: Loader;
  readonly #gatherStates = new Map<AnySource, GatherState>();
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
  #scheduledRedrawOptions?: RedrawOptions;
  #startTime = 0;
  readonly #expandedPaths = new Set<string[]>();
  #searchPath: TreePath = "";
  #items: DduItem[] = [];
  readonly #expandedItems: Set<DduItem> = new Set();

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
      const [ui, uiOptions, uiParams] = await this.#getUi(denops);
      if (!ui) {
        return;
      }
      await this.uiQuit(denops, ui, uiOptions, uiParams);
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

      const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
        await uiRedraw(
          denops,
          this,
          this.#uiRedrawLock,
          ui,
          uiOptions,
          uiParams,
          this.#aborter.signal,
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
    const [ui, uiOptions, uiParams] = await this.#getUi(denops);

    if (checkToggle && ui && uiOptions.toggle) {
      await this.uiQuit(denops, ui, uiOptions, uiParams);
      this.quit();
      return;
    }

    if (ui) {
      ui.isInitialized = false;
    }

    this.#initialized = false;
    this.#resetQuitted();
    this.#startTime = Date.now();
    const { signal } = this.#aborter;

    // Gather items asynchronously.
    const [availableSources, sourcesInitialized] = this
      .#createAvailableSourceStream(denops, { initialize: true })
      .tee();
    const [gatherStates] = availableSources
      .pipeThrough(this.#createGatherStateTransformer(denops))
      .tee();

    // Wait initialized all sources. Source onInit() must be called before UI
    await Array.fromAsync(sourcesInitialized);

    // UI should load before refresh.
    // NOTE: If UI is blocked until refresh, user input will break UI.
    await this.uiRedraw(denops, { signal });

    await this.#refreshSources(denops, gatherStates);

    this.#initialized = true;
  }

  async restart(
    denops: Denops,
    userOptions: UserOptions,
  ): Promise<void> {
    // Quit current UI
    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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

    await this.cancelToRefresh(refreshIndexes);

    // Initialize UI window
    if (!this.#options.sync) {
      // Do not await here
      this.redraw(denops);
    }

    const [gatherStates] = this
      .#createAvailableSourceStream(denops, { indexes: refreshIndexes })
      .pipeThrough(this.#createGatherStateTransformer(denops))
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

              const [source, sourceOptions, sourceParams] = await this
                .getSource(
                  denops,
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
  ): TransformStream<AvailableSourceInfo, GatherState> {
    const { signal } = this.#aborter;

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
        this.#gatherStates.set(source, state);

        controller.enqueue(state);
      },
    });
  }

  async #refreshSources(
    denops: Denops,
    gatherStates: ReadableStream<GatherState>,
  ): Promise<void> {
    const aborter = new AbortController();
    const refreshedSources: Promise<void>[] = [];

    await gatherStates.pipeTo(
      new WritableStream({
        write: (state) => {
          refreshedSources.push(
            this.#refreshItems(denops, state).catch((e) => {
              aborter.abort(e);
            }),
          );
        },
        close: async () => {
          await Promise.all(refreshedSources);
        },
      }),
      { signal: aborter.signal },
    );

    if (this.#options.sync) {
      await this.redraw(denops);
    } else {
      // Wait complete redraw
      await this.#waitRedrawComplete;
    }
  }

  async #refreshItems(denops: Denops, state: GatherState): Promise<void> {
    const { sourceInfo: { sourceOptions }, itemsStream } = state;

    await this.#callOnRefreshItemsHooks(denops, sourceOptions);

    // Get path option, or current directory instead if it is empty
    const path = sourceOptions.path.length > 0
      ? sourceOptions.path
      : await fn.getcwd(denops);

    for await (const newItems of itemsStream) {
      if (!equal(path, this.#context.path)) {
        if (this.#context.path.length > 0) {
          this.#context.pathHistories.push(this.#context.path);
        }
        this.#context.path = path;
      }

      if (!this.#options.sync && newItems.length > 0) {
        // Do not await inside loop
        this.redraw(denops);
      }
    }
  }

  async #callOnRefreshItemsHooks(
    denops: Denops,
    sourceOptions: SourceOptions,
  ): Promise<void> {
    const filters = [
      ...sourceOptions.matchers,
      ...sourceOptions.sorters,
      ...sourceOptions.converters,
    ];
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
    if (item.isExpanded && item.treePath) {
      this.#expandedPaths.add(convertTreePath(item.treePath));
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
          this.#isExpanded(convertTreePath(item.treePath)),
      ),
      __groupedPath: "",
    };
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
        await itemsStream.pipeTo(itemTransformer.writable, {
          // Do not output errors to the stream.
          preventAbort: true,
        });
      } catch (e: unknown) {
        itemTransformer.writable.close().catch(() => {
          // Prevent errors if already closed.
        });

        if (state.signal.aborted && e === state.signal.reason) {
          // Aborted by signal, so do nothing.
        } else {
          // Show error message
          errorException(
            denops,
            e,
            `source: ${source.name} "gather()" failed`,
          );
        }
      }
    })();

    return state;
  }

  redraw(
    denops: Denops,
    opts: RedrawOptions = {},
  ): Promise<unknown> {
    if (this.#waitRedrawComplete) {
      // Already redrawing, so adding to schedule
      const { restoreItemState, signal } = this.#scheduledRedrawOptions ?? {};
      this.#scheduledRedrawOptions = {
        // Override with true
        restoreItemState: opts.restoreItemState || restoreItemState,
        // Merge all signals
        signal: signal && opts.signal && signal !== opts.signal
          ? chainSignal(new AbortController(), signal, opts.signal).signal
          : opts.signal ?? signal,
      };
    } else {
      // Start redraw
      const { resolve, reject } = { promise: this.#waitRedrawComplete } =
        Promise.withResolvers<void>();
      this.#scheduledRedrawOptions = opts;

      (async () => {
        try {
          while (this.#scheduledRedrawOptions) {
            const opts = this.#scheduledRedrawOptions;
            this.#scheduledRedrawOptions = undefined;
            await this.#redrawInternal(denops, opts);
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
    opts?: RedrawOptions,
  ): Promise<void> {
    const { restoreItemState = false, signal = this.#aborter.signal } = opts ??
      {};

    if (signal.aborted) {
      return;
    }

    // Update current input
    this.#context.done = true;
    this.#context.doneUi = false;
    this.#context.input = this.#input;
    this.#context.maxItems = 0;

    const filterResults = (await Promise.all(
      this.#options.sources
        .map((source) => convertUserString(source))
        .map(async (userSource, index) => {
          const [source, sourceOptions, _] = await this.getSource(
            denops,
            userSource.name,
            userSource,
          );
          if (!source) {
            return;
          }

          const sourceInfo: SourceInfo = {
            name: userSource.name,
            index,
            path: sourceOptions.path,
            kind: source.kind ?? "base",
          };

          const [done, maxItems, items] = await this.#filterItems(
            denops,
            userSource,
            this.#input,
          );

          if (restoreItemState) {
            for (const item of items) {
              if (item.treePath) {
                item.__expanded = this.#isExpanded(
                  convertTreePath(item.treePath),
                );
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
    allItems = await this.#callFilters(
      denops,
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

    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
          },
        );
      }
    }));

    if (this.#context.done && this.#options.profile) {
      await denops.call(
        "ddu#util#print_error",
        `Refresh all items: ${Date.now() - this.#startTime} ms`,
      );
    }

    await this.uiRedraw(denops, { signal });
    if (searchTargetItem && !signal.aborted) {
      await this.uiSearchItem(denops, searchTargetItem);
    }

    this.#context.doneUi = this.#context.done;
  }

  async uiRedraw(
    denops: Denops,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const { signal = this.#aborter.signal } = opts ?? {};

    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
    if (!ui || signal.aborted) {
      return;
    }

    await uiRedraw(
      denops,
      this,
      this.#uiRedrawLock,
      ui,
      uiOptions,
      uiParams,
      signal,
    );
  }

  async uiSearchItem(
    denops: Denops,
    searchItem: DduItem,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
    if (!ui) {
      return;
    }

    await ui.searchItem({
      denops,
      context: this.#context,
      options: this.#options,
      uiOptions,
      uiParams,
      item: searchItem,
    });
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
      context: this.#context,
      options: this.#options,
      uiOptions,
      uiParams,
    });
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
    this.#quitted = true;
    this.#aborter.abort({ reason: "quit" });
    this.#context.done = true;
  }

  #resetQuitted() {
    this.#quitted = false;
    this.#resetAbortController();
  }

  async cancelToRefresh(
    refreshIndexes: number[] = [],
  ): Promise<void> {
    this.#aborter.abort({ reason: "cancelToRefresh", refreshIndexes });
    await Promise.all(
      [...this.#gatherStates]
        .filter(
          refreshIndexes.length === 0
            // Cancel all states.
            ? () => true
            // Cancel selected states.
            : ([_source, state]) =>
              refreshIndexes.includes(state.sourceInfo.sourceIndex),
        )
        .map(([source, state]) => {
          this.#gatherStates.delete(source);
          return state.waitDone;
        }),
    );

    this.#resetAbortController();
  }

  #resetAbortController() {
    if (!this.#quitted && this.#aborter.signal.aborted) {
      this.#aborter = new AbortController();
    }
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    actionParams: BaseActionParams,
  ): Promise<void> {
    const { signal } = this.#aborter;

    if (await fn.getcmdwintype(denops) !== "") {
      // Skip when Command line window
      return;
    }

    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
      await uiRedraw(
        denops,
        this,
        this.#uiRedrawLock,
        ui,
        uiOptions,
        uiParams,
        signal,
      );
    }
  }

  async getItemActions(
    denops: Denops,
    items: DduItem[],
  ): Promise<ItemActions | null> {
    const sources = [
      ...new Set(
        items.length > 0
          ? items.map((item) =>
            this.#loader.getSource(this.#options.name, item.__sourceName)
          )
          : this.#options.sources.map((userSource) =>
            this.#loader.getSource(
              this.#options.name,
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

    const [kindOptions, _1] = kindArgs(kind, this.#options);
    const [sourceOptions, _2] = sourceArgs(
      source,
      this.#options,
      this.#options.sources[indexes.length > 0 ? indexes[0] : 0],
    );

    const actions = Object.assign(
      kind.actions,
      kindOptions.actions,
      source.actions,
      sourceOptions.actions,
    );

    // Filter by options.actions
    const filteredActions = this.#options.actions.length === 0
      ? actions
      : Object.keys(actions).reduce(
        (acc: Record<ActionName, ItemAction>, key) => {
          if (this.#options.actions.includes(key)) {
            acc[key] = actions[key];
          }
          return acc;
        },
        {},
      );

    return {
      source,
      kind,
      actions: filteredActions,
    };
  }

  async getItemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    userActionParams: BaseActionParams,
  ): Promise<ItemActionInfo | undefined> {
    if (items.length === 0) {
      return;
    }

    const itemActions = await this.getItemActions(denops, items);
    if (!itemActions) {
      return;
    }

    const { source, kind, actions } = itemActions;

    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];

    const sourceIndex = indexes.length > 0 ? indexes[0] : 0;
    const userSource = this.#options.sources[sourceIndex];
    const [sourceOptions, sourceParams] = sourceArgs(
      source,
      this.#options,
      userSource,
    );

    const [kindOptions, kindParams] = kindArgs(kind, this.#options);

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
      this.#options,
      userActionParams,
    );

    // Check action aliases
    actionName = this.#loader.getAlias("action", actionName) ?? actionName;

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
      sourceIndex,
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
    const { signal } = this.#aborter;

    const itemAction = await this.getItemAction(
      denops,
      actionName,
      items,
      userActionParams,
    );
    if (!itemAction) {
      return;
    }

    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
    if (ui) {
      const visible = await ui.visible({
        denops,
        context: this.#context,
        options: this.#options,
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

    if (flags & ActionFlags.RefreshItems) {
      // Restore quitted flag before refresh and redraw
      this.#resetQuitted();
      await this.refresh(denops);
    } else if (uiOptions.persist || flags & ActionFlags.Persist) {
      // Restore quitted flag before refresh and redraw
      this.#resetQuitted();

      if (ui) {
        await uiRedraw(
          denops,
          this,
          this.#uiRedrawLock,
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
       * Otherwise, Expand recursively to the maxLevel
       */
      search?: TreePath;
      maxLevel?: number;
      preventRedraw?: boolean;
      isGrouped?: boolean;
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
      parent.__level < 0 || !parent.isTree || !parent.treePath || signal.aborted
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
    const state = this.#gatherStates.get(source);
    if (state == null) {
      return;
    }

    const [sourceOptions, sourceParams] = sourceArgs(
      source,
      this.#options,
      this.#options.sources[sourceIndex],
    );

    this.#setExpanded(convertTreePath(parent.treePath));
    parent.__expanded = true;
    this.#expandedItems.add(parent);

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
      await this.#callColumns(
        denops,
        sourceOptions.columns,
        columnItems,
        state.items.concat(columnItems),
      );

      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);

      // NOTE: Apply filter for parent item to update highlights and "display".
      const items = await this.#callFilters(
        denops,
        sourceOptions,
        filters,
        this.#input,
        [parent],
      );
      if (items.length > 0) {
        parent.display = items[0].display;
      }

      children = await this.#callFilters(
        denops,
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

    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
        this,
        this.#uiRedrawLock,
        ui,
        uiOptions,
        uiParams,
        signal,
      );

      if (!signal.aborted) {
        await ui.searchItem({
          denops,
          context: this.#context,
          options: this.#options,
          uiOptions,
          uiParams,
          item: searchedItem ?? parent,
        });
      }
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

    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
    if (!ui || signal.aborted) {
      return;
    }

    for (const item of items) {
      if (!item.treePath) {
        continue;
      }
      const index = item.__sourceIndex;
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
        this.#options.sources[index],
      );
      const state = this.#gatherStates.get(source);
      if (state == null) {
        continue;
      }

      this.#setUnexpanded(convertTreePath(item.treePath));
      item.__expanded = false;
      this.#expandedItems.delete(item);

      const columnItems = [item];
      await this.#callColumns(
        denops,
        sourceOptions.columns,
        columnItems,
        state.items.concat(columnItems),
      );

      // NOTE: Apply filter for parent item to update highlights and "display".
      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);
      const items = await this.#callFilters(
        denops,
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
        this,
        this.#uiRedrawLock,
        ui,
        uiOptions,
        uiParams,
        signal,
      );

      const searchItem = items.at(-1);

      if (searchItem && !signal.aborted) {
        await ui.searchItem({
          denops,
          context: this.#context,
          options: this.#options,
          uiOptions,
          uiParams,
          item: searchItem,
        });
      }
    }
  }

  async restoreTree(
    denops: Denops,
  ): Promise<void> {
    await this.expandItems(
      denops,
      [...this.#expandedItems].map((item) => ({
        item,
      })),
    );
  }

  async uiVisible(
    denops: Denops,
    tabNr: number,
  ): Promise<boolean> {
    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
    const [ui, uiOptions, uiParams] = await this.#getUi(denops);
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
      const [source, sourceOptions, sourceParams] = await this.getSource(
        denops,
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
        const [filter, filterOptions, filterParams] = await this.getFilter(
          denops,
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
        const [column, columnOptions, columnParams] = await this.getColumn(
          denops,
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

  async #getUi(
    denops: Denops,
  ): Promise<
    [
      BaseUi<BaseUiParams> | undefined,
      UiOptions,
      BaseUiParams,
    ]
  > {
    const userUi = convertUserString(this.#options.ui);
    if (!this.#loader.getUi(this.#options.name, userUi.name)) {
      const startTime = Date.now();

      await this.#loader.autoload(denops, "ui", userUi.name);

      if (this.#options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${userUi.name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const ui = this.#loader.getUi(this.#options.name, userUi.name);
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

    const [uiOptions, uiParams] = uiArgs(this.#options, ui);
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
    if (!this.#loader.getSource(this.#options.name, name)) {
      const startTime = Date.now();

      await this.#loader.autoload(denops, "source", name);

      if (this.#options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const source = this.#loader.getSource(this.#options.name, name);
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
      this.#options,
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

    if (!this.#loader.getFilter(this.#options.name, userFilter.name)) {
      const startTime = Date.now();

      await this.#loader.autoload(denops, "filter", userFilter.name);

      if (this.#options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${userFilter.name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const filter = this.#loader.getFilter(this.#options.name, userFilter.name);
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
      this.#options,
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
    if (!this.#loader.getKind(this.#options.name, name)) {
      const startTime = Date.now();

      await this.#loader.autoload(denops, "kind", name);

      if (this.#options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const kind = this.#loader.getKind(this.#options.name, name);
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

    if (!this.#loader.getColumn(this.#options.name, userColumn.name)) {
      const startTime = Date.now();

      await this.#loader.autoload(denops, "column", userColumn.name);

      if (this.#options.profile) {
        await denops.call(
          "ddu#util#print_error",
          `Load ${userColumn.name}: ${Date.now() - startTime} ms`,
        );
      }
    }

    const column = this.#loader.getColumn(this.#options.name, userColumn.name);
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
      this.#options,
      userColumn,
    );
    await checkColumnOnInit(column, denops, columnOptions, columnParams);

    return [column, columnOptions, columnParams];
  }

  async #filterItems(
    denops: Denops,
    userSource: UserSource,
    input: string,
  ): Promise<[boolean, number, DduItem[]]> {
    userSource = convertUserString(userSource);

    const [source, sourceOptions, _] = await this.getSource(
      denops,
      userSource.name,
      userSource,
    );

    const state = this.#gatherStates.get(source!);
    if (!state || !source) {
      return [false, 0, []];
    }

    // NOTE: Use deepcopy.  Because of filters may break original items.
    let items = structuredClone(state.items);
    const allItems = items.length;

    items = await this.#callFilters(
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

    // NOTE: Call columns before converters after matchers and sorters
    await this.#callColumns(denops, sourceOptions.columns, items, items);

    items = await this.#callFilters(
      denops,
      sourceOptions,
      sourceOptions.converters,
      input,
      items,
    );

    return [state.isDone, allItems, items];
  }

  async #callFilters(
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
          context: this.#context,
          options: this.#options,
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

  async #callColumns(
    denops: Denops,
    columns: UserColumn[],
    items: DduItem[],
    allItems: DduItem[],
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
    const userColumns = columns.map((column) => convertUserString(column));
    const cachedColumns: Record<number, CachedColumn> = {};
    for (const [index, userColumn] of userColumns.entries()) {
      const [column, columnOptions, columnParams] = await this.getColumn(
        denops,
        userColumn,
      );
      if (!column) {
        continue;
      }

      const length = await column.getLength({
        denops,
        context: this.#context,
        options: this.#options,
        columnOptions,
        columnParams,
        items: allItems,
      });

      cachedColumns[index] = {
        column,
        columnOptions,
        columnParams,
        length,
      };
    }

    for (const item of items) {
      let startCol = 1;
      for (const index of userColumns.keys()) {
        const cachedColumn = cachedColumns[index];
        if (!cachedColumn) {
          continue;
        }

        const text = await cachedColumn.column.getText({
          denops,
          context: this.#context,
          options: this.#options,
          columnOptions: cachedColumn.columnOptions,
          columnParams: cachedColumn.columnParams,
          startCol,
          endCol: startCol + cachedColumn.length,
          item,
        });

        if (text.highlights && item.highlights) {
          item.highlights = item.highlights.concat(text.highlights);
        }

        item.display += text.text;

        if (columns.length === 1) {
          // Optimize
          continue;
        }

        startCol += cachedColumn.length;

        // Check text width.
        const width = await fn.strdisplaywidth(denops, text.text);
        const len = (new TextEncoder()).encode(text.text).length;
        if (width < len) {
          // NOTE: Padding is needed.  Because Vim/neovim highlight is length.
          startCol += len - width;
          item.display += " ".repeat(len - width);
        }
      }
    }
  }

  async getPreviewer(
    denops: Denops,
    item: DduItem,
    actionParams: BaseActionParams,
    previewContext: PreviewContext,
  ): Promise<Previewer | undefined> {
    const source = this.#loader.getSource(
      this.#options.name,
      item.__sourceName,
    );
    if (!source) {
      return;
    }
    const kindName = item.kind ?? source.kind;

    const kind = await this.getKind(denops, kindName);
    if (!kind || !kind.getPreviewer) {
      return;
    }

    return kind.getPreviewer({
      denops,
      options: this.#options,
      actionParams,
      previewContext,
      item,
    });
  }

  #isExpanded(
    itemTreePath: string[],
  ): boolean {
    return Boolean(
      this.#expandedPaths.has(itemTreePath),
    );
  }
  #setExpanded(
    itemTreePath: string[],
  ): void {
    this.#expandedPaths.add(itemTreePath);
  }
  #setUnexpanded(
    itemTreePath: string[],
  ): void {
    [...this.#expandedPaths].forEach((v) => {
      if (v === itemTreePath || isParentPath(itemTreePath, v)) {
        this.#expandedPaths.delete(v);
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
  signal: AbortSignal,
): Promise<void> {
  // NOTE: Redraw must be locked
  await lock.lock(async () => {
    if (await fn.getcmdwintype(denops) !== "") {
      // Skip when Command line window
      return;
    }

    const options = ddu.getOptions();
    const context = ddu.getContext();
    try {
      if (signal.aborted) {
        await ddu.uiQuit(denops, ui, uiOptions, uiParams);
        return;
      }

      const prevWinids = await ui.winIds({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      await ui.redraw({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      // NOTE: ddu may be quitted after redraw
      if (signal.aborted) {
        await ddu.uiQuit(denops, ui, uiOptions, uiParams);
      }

      await denops.cmd("doautocmd <nomodeline> User Ddu:redraw");

      const winIds = await ui.winIds({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      if (winIds.length > prevWinids.length) {
        // NOTE: UI window is generated.
        await denops.cmd("doautocmd <nomodeline> User Ddu:uiReady");
      }
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

function chainSignal(controller: AbortController, ...signals: AbortSignal[]) {
  for (const signal of signals) {
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      signal: controller.signal,
    });
  }
  return controller;
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
