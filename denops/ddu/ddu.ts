import type {
  ActionHistory,
  BaseParams,
  Clipboard,
  Context,
  DduEvent,
  DduItem,
  DduOptions,
  ExpandItem,
  Item,
  SourceInfo,
  SourceOptions,
  TreePath,
  UserOptions,
  UserSource,
} from "./types.ts";
import { ActionFlags } from "./types.ts";
import {
  defaultContext,
  defaultDduOptions,
  foldMerge,
  mergeDduOptions,
} from "./context.ts";
import { defaultSourceOptions } from "./base/source.ts";
import type { BaseSource } from "./base/source.ts";
import type { Loader } from "./loader.ts";
import {
  convertTreePath,
  convertUserString,
  getFilters,
  printError,
  treePath2Filename,
} from "./utils.ts";
import type {
  AvailableSourceInfo,
  GatherStateAbortable,
  GatherStateAbortReason,
} from "./state.ts";
import {
  GatherState,
  isRefreshTarget,
  QuitAbortReason,
  RefreshAbortReason,
} from "./state.ts";
import {
  callColumns,
  callFilters,
  callOnRefreshItemsHooks,
  getColumn,
  getFilter,
  getItemAction,
  getSource,
  getUi,
  initSource,
  sourceArgs,
  uiAction,
  uiQuit,
  uiRedraw,
  uiSearchItem,
} from "./ext.ts";

import type { Denops } from "@denops/std";
import * as fn from "@denops/std/function";

import { assertEquals } from "@std/assert/equals";
import { equal } from "@std/assert/equal";
import { basename } from "@std/path/basename";
import { dirname } from "@std/path/dirname";
import type { Lock } from "@core/asyncutil/lock";
import { SEPARATOR as pathsep } from "@std/path/constants";

type RedrawOptions = {
  /**
   * NOTE: Set restoreItemState to true if redraw without regather because
   * item's states reset to gathered.
   */
  restoreItemState?: boolean;
  restoreTree?: boolean;
  signal?: AbortSignal;
};

type RefreshOptions = Omit<RedrawOptions, "signal">;

export class Ddu {
  #loader: Loader;
  readonly #gatherStates = new Map<number, GatherState>();
  #input = "";
  #inputHistory: string[] = [];
  #context: Context = defaultContext();
  #options: DduOptions = defaultDduOptions();
  #userOptions: UserOptions = {};
  #initialized = false;
  #quitted = false;
  #aborter = new AbortController() as
    & Omit<AbortController, "abort">
    & GatherStateAbortable;
  readonly #uiRedrawLock: Lock<number>;
  #waitCancelComplete = Promise.resolve();
  #waitRedrawComplete?: Promise<void>;
  #scheduledRedrawOptions?: Required<RedrawOptions>;
  #startTime = 0;
  #searchPath: TreePath = "";
  #items: DduItem[] = [];
  readonly #expandedItems: Map<string, DduItem> = new Map();

  constructor(loader: Loader, uiRedrawLock: Lock<number>) {
    this.#loader = loader;
    this.#uiRedrawLock = uiRedrawLock;
  }

  get cancelled(): AbortSignal {
    return this.#aborter.signal;
  }

  async start(
    denops: Denops,
    context: Context,
    options: DduOptions,
    userOptions: UserOptions,
  ): Promise<void> {
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

      await this.updateOptions(denops, userOptions);

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
        await this.uiRedraw(denops);
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
      ui.prevDone = false;
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
      .pipeThrough(this.#createGatherStateTransformer(denops))
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
    await this.updateOptions(denops, userOptions);

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
    opts?: RefreshOptions,
  ): Promise<AbortSignal> {
    this.#startTime = Date.now();
    this.#context.done = false;

    await this.cancelToRefresh(refreshIndexes);
    this.resetAborter();

    // NOTE: Get the signal after the aborter is reset.
    const { signal } = this.#aborter;

    const [gatherStates] = this
      .#createAvailableSourceStream(denops, { indexes: refreshIndexes })
      .pipeThrough(this.#createGatherStateTransformer(denops))
      .tee();

    await this.#refreshSources(denops, gatherStates, { ...opts, signal });

    return signal;
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
    return new TransformStream({
      transform: (sourceInfo, controller) => {
        const { sourceIndex, source, sourceOptions, sourceParams } = sourceInfo;

        const state = this.#gatherItems(
          denops,
          sourceIndex,
          source,
          sourceOptions,
          sourceParams,
          0,
        );
        this.#gatherStates.set(sourceIndex, state);

        controller.enqueue(state);
      },
    });
  }

  async #refreshSources(
    denops: Denops,
    gatherStates: ReadableStream<GatherState>,
    opts?: RedrawOptions,
  ): Promise<void> {
    const redrawOpts = { signal: this.#aborter.signal, ...opts };
    const refreshErrorHandler = new AbortController();
    const refreshedSources: Promise<void>[] = [];

    await gatherStates.pipeTo(
      new WritableStream({
        write: (state) => {
          refreshedSources.push(
            this.#refreshItems(denops, state, redrawOpts).catch((e) => {
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

    if (redrawOpts.signal.aborted) {
      // Redraw is aborted, so do nothing
    } else if (!this.#context.done) {
      await this.redraw(denops, redrawOpts);
    } else {
      await this.#waitRedrawComplete;
    }
  }

  async #refreshItems(
    denops: Denops,
    state: GatherState,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const { sourceInfo: { sourceOptions }, itemsStream } = state;

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

      if (this.#checkSync() && newItems.length > 0) {
        /* no await */ this.redraw(denops, opts);
      }
    }
  }

  #newDduItem<
    Params extends BaseParams,
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
    Params extends BaseParams,
    UserData extends unknown,
  >(
    denops: Denops,
    sourceIndex: number,
    source: BaseSource<Params, UserData>,
    sourceOptions: SourceOptions,
    sourceParams: Params,
    itemLevel: number,
    opts?: {
      parent?: DduItem;
    },
  ): GatherState<Params, UserData> {
    const { parent } = opts ?? {};

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
        });

        // Wait until the stream closes.
        await itemsStream.pipeTo(itemTransformer.writable);
      } catch (e: unknown) {
        if (state.cancelled.aborted && e === state.cancelled.reason) {
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
  ): Promise<void> {
    const newOpts = {
      restoreItemState: false,
      restoreTree: false,
      signal: this.#aborter.signal,
      ...opts,
    };

    if (this.#waitRedrawComplete) {
      // Already redrawing, so adding to schedule
      const prevOpts: RedrawOptions = this.#scheduledRedrawOptions ?? {};
      this.#scheduledRedrawOptions = {
        ...newOpts,
        // Override with true
        restoreItemState: prevOpts.restoreItemState || newOpts.restoreItemState,
        restoreTree: prevOpts.restoreTree || newOpts.restoreTree,
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
    { restoreItemState, restoreTree, signal }: Required<RedrawOptions>,
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    // Update current context
    this.#context.doneUi = false;
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
                item.isExpanded = item.__expanded;
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

    if (restoreTree) {
      await this.restoreTree(denops, { preventRedraw: true, signal });
    }

    const searchPath = this.#searchPath;

    let searchTargetItem: DduItem | undefined;

    const searchTreePath = convertTreePath(searchPath);
    await Promise.all(allItems.map(async (item: DduItem): Promise<void> => {
      if (searchPath) {
        const itemTreePath = convertTreePath(item.treePath ?? item.word);

        if (equal(searchTreePath, itemTreePath)) {
          searchTargetItem = item;
        }

        if (
          !searchTargetItem && item.treePath &&
          isParentPath(itemTreePath, searchTreePath)
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
      // Prevent infinite loop
      this.#searchPath = "";

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
      this.#loader,
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
    const reason = new QuitAbortReason();
    this.#aborter.abort(reason);
    /* no await */ this.#cancelGatherStates([], reason);
    this.#context.done = true;
  }

  #resetQuitted() {
    this.#quitted = false;
    this.resetAborter();
  }

  async cancelToRefresh(
    refreshIndexes: number[] = [],
  ): Promise<void> {
    const reason = new RefreshAbortReason(refreshIndexes);
    this.#aborter.abort(reason);
    await this.#cancelGatherStates(refreshIndexes, reason);
  }

  #cancelGatherStates(
    sourceIndexes: number[],
    reason: GatherStateAbortReason,
  ): Promise<void> {
    const promises = [...this.#gatherStates]
      .filter(([sourceIndex]) => isRefreshTarget(sourceIndex, sourceIndexes))
      .map(([_, state]) => {
        state.cancel(reason);
        return state.waitDone;
      });
    this.#waitCancelComplete = Promise.all([
      this.#waitCancelComplete,
      ...promises,
    ]).then(() => {});
    return this.#waitCancelComplete;
  }

  resetAborter() {
    if (!this.#quitted && this.#aborter.signal.aborted) {
      this.#aborter = new AbortController();
    }
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    actionParams: BaseParams,
  ): Promise<void> {
    if (await fn.getcmdwintype(denops) !== "") {
      // Skip when Command line window
      return;
    }

    const [ui, uiOptions, uiParams, ret] = await uiAction(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      actionName,
      actionParams,
      this.#inputHistory,
    );
    if (!ui) {
      return;
    }

    // NOTE: Get the signal after the UI action finishes.
    const { signal } = this.#aborter;

    const flags = typeof ret === "number" ? ret : ActionFlags.None;

    // Update current input
    await this.setInput(denops, this.#context.input);

    if (flags & ActionFlags.RefreshItems) {
      await this.refresh(denops, [], { restoreTree: true });
    } else if (flags & ActionFlags.Redraw) {
      await uiRedraw(
        denops,
        this.#uiRedrawLock,
        this.#loader,
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

    // NOTE: Update inputHistory when uiAction
    this.#updateInputHistory();
  }

  async itemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    userActionParams: BaseParams,
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
    const limitPath = chompTreePath(itemAction.sourceOptions.limitPath);
    const newPath = chompTreePath(itemAction.sourceOptions.path);
    if (
      newPath.length > 0 &&
      !equal(newPath, prevPath) && (
        limitPath.length === 0 ||
        treePath2Filename(newPath) === treePath2Filename(limitPath) ||
        isParentPath(
          convertTreePath(limitPath),
          convertTreePath(newPath),
        )
      )
    ) {
      itemAction.userSource = convertUserString(itemAction.userSource);
      // Overwrite current path
      if (!itemAction.userSource.options) {
        itemAction.userSource.options = {};
      }
      itemAction.userSource.options.path = newPath;
      if (this.#context.path.length > 0) {
        this.#context.pathHistories.push(this.#context.path);
      }

      // Overwrite userSource
      this.#options.sources[itemAction.sourceIndex] = itemAction.userSource;

      this.#context.path = newPath;

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
    if (!ui) {
      return;
    }

    if (ui?.clearSelectedItems) {
      await ui.clearSelectedItems({
        denops,
        context: this.#context,
        options: this.#options,
        uiOptions,
        uiParams,
      });
    }

    if (flags & ActionFlags.RefreshItems) {
      // Restore quitted flag before refresh and redraw
      this.#resetQuitted();

      await this.refresh(denops, [], { restoreTree: true });
    } else if (uiOptions.persist || flags & ActionFlags.Persist) {
      // Restore quitted flag before refresh and redraw
      this.#resetQuitted();

      // NOTE: Get the signal after the aborter is reset.
      const { signal } = this.#aborter;

      await uiRedraw(
        denops,
        this.#uiRedrawLock,
        this.#loader,
        this.#context,
        this.#options,
        ui,
        uiOptions,
        uiParams,
        signal,
      );
    }

    if (flags & ActionFlags.RestoreCursor) {
      // Restore the cursor
      await fn.win_gotoid(denops, winId);
    }
  }

  async expandItems(
    denops: Denops,
    items: ExpandItem[],
    opts?: {
      preventRedraw?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const { preventRedraw, signal = this.#aborter.signal } = opts ?? {};
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

    if (!preventRedraw && !signal.aborted) {
      await this.uiRedraw(denops, { signal });
    }
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
        parent.__level + 1,
        { parent },
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
      const columnItems = [parent, ...children];
      await callColumns(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions.columns,
        columnItems,
        [...state.items, ...columnItems],
      );

      const parentFilters = await getFilters(
        denops,
        this.#context,
        this.#options,
        sourceOptions,
        this.#input,
        [parent],
      );

      // NOTE: Apply filter for parent item to update highlights and "display".
      const items = await callFilters(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions,
        [
          ...parentFilters.matchers,
          ...parentFilters.sorters,
          ...parentFilters.converters,
        ],
        this.#input,
        [parent],
      );
      if (items.length > 0) {
        parent.display = items[0].display;
      }

      const childrenFilters = await getFilters(
        denops,
        this.#context,
        this.#options,
        sourceOptions,
        this.#input,
        children,
      );

      children = await callFilters(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions,
        [
          ...childrenFilters.matchers,
          ...childrenFilters.sorters,
          ...childrenFilters.converters,
        ],
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
      // Filter out children that are already added by the source
      const newChildren = children.filter(child => {
        const childKey = item2Key(child);
        return !this.#items.some(item => item2Key(item) === childKey);
      });

      await ui.expandItem({
        denops,
        context: this.#context,
        options: this.#options,
        uiOptions,
        uiParams,
        parent,
        children: newChildren,
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
        search === (item.treePath ?? item.word)
      );
    }

    if (ui && !signal.aborted && !preventRedraw) {
      await uiRedraw(
        denops,
        this.#uiRedrawLock,
        this.#loader,
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
        [...state.items, ...columnItems],
      );

      // NOTE: Apply filter for parent item to update highlights and "display".
      const filters = await getFilters(
        denops,
        this.#context,
        this.#options,
        sourceOptions,
        this.#input,
        [item],
      );
      const items = await callFilters(
        denops,
        this.#loader,
        this.#context,
        this.#options,
        sourceOptions,
        [
          ...filters.matchers,
          ...filters.sorters,
          ...filters.converters,
        ],
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
        this.#loader,
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

  async uiUpdateCursor(
    denops: Denops,
  ) {
    const [ui, uiOptions, uiParams] = await getUi(
      denops,
      this.#loader,
      this.#options,
    );
    if (!ui?.updateCursor || this.#quitted) {
      return;
    }

    await ui.updateCursor({
      denops,
      context: this.#context,
      options: this.#options,
      uiOptions,
      uiParams,
    });
  }

  async setInput(denops: Denops, input: string) {
    if (this.#options.expandInput && !input.startsWith("<")) {
      // NOTE: expand() result will be broken if "input" starts "<".
      input = await fn.expand(denops, input) as string;
    }
    this.#input = input;
    this.#context.input = input;
  }

  getContext(): Context {
    return this.#context;
  }

  getOptions(): DduOptions {
    return this.#options;
  }

  getUserOptions(): UserOptions {
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
      const filters = [
        ...sourceOptions.matchers,
        ...sourceOptions.sorters,
        ...sourceOptions.converters,
      ];
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

  getSourceArgs(): [SourceOptions, BaseParams][] {
    return this.#options.sources.map((userSource) =>
      sourceArgs(
        this.#loader.getSource(
          convertUserString(userSource).name,
        ),
        this.#options,
        userSource,
      )
    );
  }

  getItems(): DduItem[] {
    return this.#items;
  }

  async updateOptions(denops: Denops, userOptions: UserOptions) {
    this.#options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.#options,
      userOptions,
    ]);

    if (userOptions.input) {
      await this.setInput(denops, this.#options.input);
    }
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
    opts?: {
      preventRedraw?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    // NOTE: Check expandedItems are exists in this.#items
    const checkItems: Map<string, DduItem> = new Map();
    for (const item of this.#items) {
      checkItems.set(item2Key(item), item);
    }

    const restoreItems = [...this.#expandedItems.values()].filter((item) => {
      let k = item2Key(item);

      // Check all parent paths.
      while (k.length !== 0) {
        if (checkItems.has(k)) {
          return true;
        }

        const parent = dirname(k);
        if (k === parent) {
          break;
        }

        k = parent;
      }

      return false;
    }).map((item) => ({ item }));

    if (restoreItems.length === 0) {
      return;
    }

    await this.expandItems(denops, restoreItems, opts);
  }

  // For debug.
  checkState() {
    for (const sourceIndex of this.#gatherStates.keys()) {
      const state = this.#gatherStates.get(sourceIndex);
      const allItems = state ? state.items.length : 0;
      console.log(`state index=${sourceIndex}, items=${allItems}`);
    }
  }

  #preserveParentItems(
    filteredItems: DduItem[],
    originalItems: DduItem[],
  ): DduItem[] {
    // Early return if no items have tree paths
    if (!filteredItems.some((item) => item.treePath)) {
      return filteredItems;
    }

    // Create a set of matched item keys for quick lookup
    const matchedKeys = new Set(filteredItems.map((item) => item2Key(item)));

    // Build a map of all items by their key
    const itemsByKey = new Map<string, DduItem>();
    for (const item of originalItems) {
      itemsByKey.set(item2Key(item), item);
    }

    // Find all parent items that need to be preserved
    const parentsToAdd = new Map<string, DduItem>();

    for (const item of filteredItems) {
      if (!item.treePath) continue;

      const itemTreePath = convertTreePath(item.treePath);

      // Check all potential parent paths
      for (const [key, candidate] of itemsByKey) {
        if (matchedKeys.has(key)) continue; // Already matched
        if (!candidate.treePath) continue;

        const candidateTreePath = convertTreePath(candidate.treePath);

        // If this candidate is a parent of our matched item
        if (isParentPath(candidateTreePath, itemTreePath)) {
          parentsToAdd.set(key, candidate);
          // Mark parent as expanded
          candidate.__expanded = true;
          candidate.isExpanded = true;
          this.#setExpanded(candidate);
        }
      }
    }

    // Combine filtered items with their parents
    const result = [...filteredItems];
    for (const parent of parentsToAdd.values()) {
      result.push(parent);
    }

    // Sort by level to maintain tree structure (parents before children)
    return result.sort((a, b) => {
      // First sort by level
      if (a.__level !== b.__level) {
        return a.__level - b.__level;
      }
      // Then by tree path for consistent ordering
      const aPath = convertTreePath(a.treePath ?? a.word);
      const bPath = convertTreePath(b.treePath ?? b.word);
      return aPath.join(pathsep).localeCompare(bPath.join(pathsep));
    });
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

    // NOTE: Call columns before filters
    await callColumns(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      sourceOptions.columns,
      items,
      items,
    );

    // Save original items before filtering for parent preservation
    // Only clone if we have tree items that might need parent preservation
    const hasTreeItems = items.some(
      (item) => item.treePath && item.isTree && item.isExpanded,
    );
    const originalItems = hasTreeItems
      ? structuredClone(items) as DduItem[]
      : items;

    const filters = await getFilters(
      denops,
      this.#context,
      this.#options,
      sourceOptions,
      input,
      items,
    );
    items = await callFilters(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      sourceOptions,
      [...filters.matchers, ...filters.sorters],
      input,
      items,
    );

    // Preserve parent items with matching children
    if (hasTreeItems) {
      items = this.#preserveParentItems(items, originalItems);
    }

    // Truncate before converters
    if (items.length > sourceOptions.maxItems) {
      items = items.slice(0, sourceOptions.maxItems);
    }

    items = await callFilters(
      denops,
      this.#loader,
      this.#context,
      this.#options,
      sourceOptions,
      filters.converters,
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

  #updateInputHistory() {
    // NOTE: this.#inputHistory must be unique
    this.#inputHistory.push(this.#input);
    this.#inputHistory = Array.from(new Set(this.#inputHistory.reverse()))
      .reverse();
  }

  #checkSync() {
    return !this.#options.sync ||
      (this.#options.syncLimit > 0 &&
        this.#items.length >= this.#options.syncLimit) ||
      (this.#options.syncTimeout > 0 &&
        (Date.now() - this.#startTime) >= this.#options.syncTimeout);
  }
}

function chompTreePath(treePath?: TreePath): TreePath {
  if (!treePath) {
    return [];
  }

  if (typeof treePath === "string") {
    return treePath.endsWith(pathsep) ? treePath.slice(0, -1) : treePath;
  }

  treePath = treePath.map((path) =>
    path.endsWith(pathsep) ? path.slice(0, -1) : path
  );

  // Remove empty strings from the end of the array
  while (treePath.length > 0 && treePath[treePath.length - 1] === "") {
    treePath.pop();
  }

  return treePath;
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
  assertEquals([], chompTreePath(undefined));
  assertEquals(["hoge"], chompTreePath("hoge/".split("/")));
});
