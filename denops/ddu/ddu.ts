import {
  assertEquals,
  basename,
  Denops,
  echo,
  equal,
  fn,
  Lock,
  op,
  parse,
  pathsep,
  toFileUrl,
} from "./deps.ts";
import {
  ActionArguments,
  ActionFlags,
  ActionHistory,
  ActionOptions,
  ActionResult,
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
  DduExtType,
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
  UiOptions,
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

type GatherState = {
  items: DduItem[];
  done: boolean;
};

type ItemActions = {
  source: BaseSource<BaseSourceParams, unknown>;
  kind: BaseKind<BaseKindParams>;
  actions: Record<string, unknown>;
};

export class Ddu {
  private uis: Record<string, BaseUi<BaseUiParams>> = {};
  private sources: Record<string, BaseSource<BaseSourceParams>> = {};
  private filters: Record<string, BaseFilter<BaseFilterParams>> = {};
  private kinds: Record<string, BaseKind<BaseKindParams>> = {};
  private columns: Record<string, BaseColumn<BaseColumnParams>> = {};
  private aliases: Record<DduExtType | "action", Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
    action: {},
  };

  private checkPaths: Record<string, boolean> = {};
  private gatherStates: Record<string, GatherState> = {};
  private input = "";
  private context: Context = defaultContext();
  private options: DduOptions = defaultDduOptions();
  private userOptions: UserOptions = {};
  private initialized = false;
  private quitted = false;
  private cancelToRefresh = false;
  private lock = new Lock(0);
  private startTime = 0;
  private expandedPaths = new Set<string>();
  private searchPath = "";

  private shouldStopCurrentContext(): boolean {
    return this.quitted || this.cancelToRefresh;
  }

  async start(
    denops: Denops,
    aliases: Record<DduExtType | "action", Record<string, string>>,
    context: Context,
    options: DduOptions,
    userOptions: UserOptions,
  ): Promise<void> {
    const prevInput = this.context.input;
    const prevPath = this.context.path;

    this.aliases = aliases;
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
    }

    const checkToggle = this.initialized && !this.quitted &&
      !userOptions?.refresh;

    if (
      this.initialized && resume && !uiChanged &&
      (!userOptions?.sources ||
        equal(userOptions.sources, this.options.sources))
    ) {
      // NOTE: sources must not overwrite
      userOptions.sources = this.options.sources;

      this.updateOptions(userOptions);

      // Set input
      if (userOptions?.input !== undefined) {
        await this.setInput(denops, userOptions.input as string);
      } else if (prevInput !== "") {
        await this.setInput(denops, prevInput);
      }

      // Set path
      this.context.path = prevPath;

      const [ui, uiOptions, uiParams] = await this.getUi(denops);
      if (!ui) {
        return;
      }

      if (checkToggle && uiOptions.toggle) {
        await this.uiQuit(denops, ui, uiOptions, uiParams);
        return;
      }

      if (userOptions.searchPath) {
        // Apply only defined by new options
        this.searchPath = userOptions.searchPath as string;
      }

      if (!this.options?.refresh) {
        this.quitted = false;

        if (this.searchPath) {
          // Redraw only without regather items.
          return this.redraw(denops, true);
        }

        // UI Redraw only
        // NOTE: Enable done to redraw UI properly
        this.context.done = true;
        await uiRedraw(
          denops,
          this.lock,
          this.context,
          this.options,
          ui,
          uiOptions,
          uiParams,
        );
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
    if (!ui) {
      return;
    }
    if (checkToggle && uiOptions.toggle) {
      await this.uiQuit(denops, ui, uiOptions, uiParams);
      return;
    }

    ui.isInitialized = false;

    this.initialized = false;
    this.quitted = false;

    // Source onInit() must be called before UI
    for (const userSource of this.options.sources) {
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
    aliases: Record<DduExtType | "action", Record<string, string>>,
    userOptions: UserOptions,
  ): Promise<void> {
    // Quit current UI
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }
    await this.uiQuit(denops, ui, uiOptions, uiParams);

    // Disable resume
    userOptions.resume = false;

    // Restart
    this.updateOptions(userOptions);
    await this.start(
      denops,
      aliases,
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
    this.cancelToRefresh = true;
    for (const state of Object.values(this.gatherStates)) {
      while (!state.done) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    this.cancelToRefresh = false;

    // Initialize UI window
    if (!this.options.sync) {
      await this.redraw(denops);
    }

    await Promise.all(
      this.options.sources.map(
        async (userSource: UserSource, index: number): Promise<void> => {
          if (refreshIndexes.length > 0 && !refreshIndexes.includes(index)) {
            // Skip
            return;
          }

          const state: GatherState = {
            items: [],
            done: false,
          };

          this.gatherStates[index] = state;

          const source = this.sources[userSource.name];

          if (!source) {
            await denops.call(
              "ddu#util#print_error",
              `Not found source: ${userSource.name}`,
            );
            state.done = true;
            return;
          }

          const [sourceOptions, sourceParams] = sourceArgs(
            this.options,
            userSource,
            source,
          );

          // Call "onRefreshItems" hooks
          const filters = sourceOptions.matchers.concat(
            sourceOptions.sorters,
          ).concat(sourceOptions.converters);
          for (const filterName of filters) {
            const [filter, filterOptions, filterParams] = await this.getFilter(
              denops,
              filterName,
            );
            if (!filter || !filter.onRefreshItems) {
              continue;
            }

            await filter.onRefreshItems({
              denops,
              filterOptions,
              filterParams,
            });
          }

          let prevLength = state.items.length;

          for await (
            const newItems of this.gatherItems(
              denops,
              index,
              source,
              sourceOptions,
              sourceParams,
              0,
            )
          ) {
            if (this.shouldStopCurrentContext()) {
              break;
            }

            let path = sourceOptions.path;
            if (path === "") {
              // Use current directory instead
              path = await fn.getcwd(denops) as string;
            }
            if (path !== this.context.path) {
              if (this.context.path.length > 0) {
                this.context.pathHistories.push(this.context.path);
              }
              this.context.path = path;
            }

            state.items = state.items.concat(newItems);

            if (prevLength !== state.items.length && !this.options.sync) {
              await this.redraw(denops);
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
    return {
      ...item,
      kind: item.kind ?? source.kind,
      matcherKey,
      __sourceIndex: sourceIndex,
      __sourceName: source.name,
      __level: level ?? item.level ?? 0,
      __expanded: Boolean(
        item.treePath &&
          this.isExpanded(item.treePath),
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
    itemLevel?: number,
    parent?: DduItem,
  ): AsyncGenerator<DduItem[]> {
    const sourceItems = source.gather({
      denops,
      context: this.context,
      options: this.options,
      sourceOptions,
      sourceParams,
      input: this.input,
      parent,
    });

    for await (const chunk of sourceItems) {
      if (this.shouldStopCurrentContext()) {
        return;
      }
      const newItems = chunk.map((item: Item) =>
        this.newDduItem(
          index,
          source,
          sourceOptions,
          item,
          itemLevel,
        )
      );

      yield newItems;
    }
  }

  async redraw(
    denops: Denops,
    // NOTE: Set restoreItemState to true if redraw without regather because
    // item's states reset to gathered.
    restoreItemState?: boolean,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui || this.quitted) {
      return;
    }

    // Update current input
    this.context.done = true;
    this.context.input = this.input;
    this.context.maxItems = 0;

    const sources: SourceInfo[] = [];
    let allItems: DduItem[] = [];
    let index = 0;
    for (const userSource of this.options.sources) {
      const source = this.sources[userSource.name];
      if (!source) {
        await denops.call(
          "ddu#util#print_error",
          `Not found source: ${userSource.name}`,
        );
        return;
      }
      const [sourceOptions, _] = sourceArgs(
        this.options,
        userSource,
        source,
      );
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
      if (restoreItemState) {
        items.forEach((item) => {
          if (item.treePath) {
            item.__expanded = this.isExpanded(item.treePath);
          }
        });
      }
      allItems = allItems.concat(items);
      this.context.done = done && this.context.done;
      this.context.maxItems += maxItems;

      index++;
    }

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
          isParentPath(item.treePath, searchPath)
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

      if (item.__expanded) {
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
      echo(denops, `Refresh all items: ${Date.now() - this.startTime} ms`);
    }

    await this.uiRedraw(denops, searchTargetItem);
  }

  async uiRedraw(
    denops: Denops,
    searchItem?: DduItem,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui || this.quitted) {
      return;
    }

    await uiRedraw(
      denops,
      this.lock,
      this.context,
      this.options,
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
    this.quitted = true;
  }

  async onEvent(
    denops: Denops,
    event: DduEvent,
  ): Promise<void> {
    for (const userSource of this.options.sources) {
      const source = this.sources[userSource.name];
      if (!source) {
        continue;
      }
      const [sourceOptions, sourceParams] = sourceArgs(
        this.options,
        userSource,
        source,
      );

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
    this.quitted = true;
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

    let flags: ActionFlags;
    if (uiOptions.actions[actionName]) {
      flags = await denops.call(
        "denops#callback#call",
        uiOptions.actions[actionName],
        {
          context: this.context,
          options: this.options,
          uiOptions,
          uiParams,
          actionParams,
        },
      ) as ActionFlags;
    } else {
      const action = ui.actions[actionName];
      if (!action) {
        await denops.call(
          "ddu#util#print_error",
          `Not found UI action: ${actionName}`,
        );
        return;
      }

      flags = await action({
        denops,
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

  async getItemActions(
    denops: Denops,
    items: DduItem[],
  ): Promise<ItemActions | null> {
    const sources = [
      ...new Set(
        items.length > 0
          ? items.map((item) => this.sources[item.__sourceName])
          : this.options.sources.map((userSource) =>
            this.sources[userSource.name]
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
            sources.map((source) => source.name)
          }"`,
        );
      }
      return null;
    }
    const source = sources[0];

    const kinds = [
      ...new Set(
        items.length > 0
          ? items.map((item) => item.kind)
          : sources.map((source) => source.kind),
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
    if (kindName === "base") {
      // Dummy kind
      return null;
    }

    const kind = await this.getKind(denops, kindName);
    if (!kind) {
      return null;
    }

    const [kindOptions, _1] = kindArgs(this.options, kind);
    const [sourceOptions, _2] = sourceArgs(
      this.options,
      this.options.sources[indexes.length > 0 ? indexes[0] : 0],
      source,
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

  async itemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    userActionParams: BaseActionParams,
    clipboard: Clipboard,
    actionHistory: ActionHistory,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const ret = await this.getItemActions(denops, items);
    if (!ret) {
      return;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }

    const { source, kind, actions } = ret;

    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];

    const userSource = this.options.sources[
      indexes.length > 0 ? indexes[0] : 0
    ];
    const [sourceOptions, sourceParams] = sourceArgs(
      this.options,
      userSource,
      source,
    );

    const [kindOptions, kindParams] = kindArgs(this.options, kind);

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

    // Note: "actionName" may be overwritten by aliases
    const [actionOptions, actionParams] = actionArgs(
      this.options,
      actionName,
      userActionParams,
    );

    // Check action aliases
    if (this.aliases.action[actionName]) {
      actionName = this.aliases.action[actionName];
    }

    const action = actions[actionName] as (
      args: ActionArguments<BaseActionParams>,
    ) => Promise<ActionFlags | ActionResult>;
    if (!action) {
      await denops.call(
        "ddu#util#print_error",
        `Not found action: ${actionName}`,
      );
      return;
    }

    if (actionOptions.quit) {
      // Quit UI before action
      await ui.quit({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
      });
      this.quitted = true;
    }

    let flags: ActionFlags;
    let searchPath = "";
    if (sourceOptions.actions[actionName]) {
      flags = await denops.call(
        "denops#callback#call",
        sourceOptions.actions[actionName],
        {
          context: this.context,
          options: this.options,
          actionParams,
          items: items,
        },
      ) as ActionFlags;
    } else if (kindOptions.actions[actionName]) {
      flags = await denops.call(
        "denops#callback#call",
        kindOptions.actions[actionName],
        {
          context: this.context,
          options: this.options,
          actionParams,
          items: items,
        },
      ) as ActionFlags;
    } else {
      const prevPath = sourceOptions.path;
      const ret = await action({
        denops,
        context: this.context,
        options: this.options,
        sourceOptions,
        sourceParams,
        kindOptions,
        kindParams,
        actionParams,
        items,
        clipboard,
        actionHistory,
      });

      if (typeof (ret) === "object") {
        flags = ret.flags;
        searchPath = ret.searchPath;
      } else {
        flags = ret;
      }

      // Check path is changed by action
      if (sourceOptions.path !== prevPath) {
        // Overwrite current path
        if (!userSource.options) {
          userSource.options = sourceOptions;
        }
        userSource.options.path = sourceOptions.path;
        if (this.context.path.length > 0) {
          this.context.pathHistories.push(this.context.path);
        }
        this.context.path = sourceOptions.path;
      }
    }

    if (searchPath.length > 0) {
      this.searchPath = searchPath;
    }

    const winId = await fn.win_getid(denops);

    if (flags & ActionFlags.RefreshItems) {
      // Restore quitted flag before refresh and redraw
      this.quitted = false;
      await this.refresh(denops);
    } else if (uiOptions.persist || flags & ActionFlags.Persist) {
      // Restore quitted flag before refresh and redraw
      this.quitted = false;
      await ui.redraw({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
      });
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
        this.lock,
        this.context,
        this.options,
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
      search: string;
      maxLevel: number;
      preventRedraw?: boolean;
    },
  ): Promise<DduItem /* searchedItem */ | undefined> {
    if (parent.__level < 0 || !parent.treePath) {
      return;
    }

    const index = parent.__sourceIndex;
    const source = this.sources[parent.__sourceName];
    const [sourceOptions, sourceParams] = sourceArgs(
      this.options,
      this.options.sources[index],
      source,
    );

    this.setExpanded(parent.treePath);
    parent.__expanded = true;

    // Set path
    sourceOptions.path = parent.treePath ?? parent.word;
    this.context.path = sourceOptions.path;

    let children: DduItem[] = [];

    for await (
      const newItems of this.gatherItems(
        denops,
        index,
        source,
        sourceOptions,
        sourceParams,
        parent.__level + 1,
        parent,
      )
    ) {
      if (this.shouldStopCurrentContext()) {
        return;
      }

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
            isParentPath(child.treePath, options.search)
        )
        : children.filter((child) =>
          // Expand recursively to the maxLevel
          child.__expanded ||
          child.isTree && child.treePath &&
            // NOTE: Skip hidden directory
            !basename(child.treePath).startsWith(".")
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
      isParentPath(parent.treePath, options.search)
    ) {
      searchedItem = children.find((item) =>
        options.search === item.treePath ?? item.word
      );
    }

    if (ui && !this.shouldStopCurrentContext() && !options.preventRedraw) {
      await uiRedraw(
        denops,
        this.lock,
        this.context,
        this.options,
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
      const source = this.sources[item.__sourceName];
      const [sourceOptions, _] = sourceArgs(
        this.options,
        this.options.sources[index],
        source,
      );

      if (!item.treePath) {
        continue;
      }

      this.setUnexpanded(item.treePath);
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
        this.lock,
        this.context,
        this.options,
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
    if (!ui || !ui.visible || this.quitted) {
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
    if (!ui || !ui.winId || this.quitted) {
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

  async register(type: DduExtType, path: string, name: string) {
    if (path in this.checkPaths) {
      return;
    }
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    let add;
    switch (type) {
      case "ui":
        add = (name: string) => {
          const obj = new mod.Ui();
          obj.name = name;
          obj.path = path;
          this.uis[obj.name] = obj;
        };
        break;
      case "source":
        add = (name: string) => {
          const obj = new mod.Source();
          obj.name = name;
          obj.path = path;
          this.sources[obj.name] = obj;
        };
        break;
      case "filter":
        add = (name: string) => {
          const obj = new mod.Filter();
          obj.name = name;
          obj.path = path;
          this.filters[obj.name] = obj;
        };
        break;
      case "kind":
        add = (name: string) => {
          const obj = new mod.Kind();
          obj.name = name;
          obj.path = path;
          this.kinds[obj.name] = obj;
        };
        break;
      case "column":
        add = (name: string) => {
          const obj = new mod.Column();
          obj.name = name;
          obj.path = path;
          this.columns[obj.name] = obj;
        };
        break;
    }

    add(name);

    // Check alias
    const aliases = Object.keys(this.aliases[type]).filter(
      (k) => this.aliases[type][k] === name,
    );
    for (const alias of aliases) {
      add(alias);
    }
  }

  async autoload(
    denops: Denops,
    type: DduExtType,
    name: string,
  ) {
    const paths = await globpath(
      denops,
      `denops/@ddu-${type}s/`,
      this.aliases[type][name] ?? name,
    );

    await Promise.all(
      paths.map((path) => this.register(type, path, parse(path).name)),
    );
  }

  async setInput(denops: Denops, input: string) {
    if (this.options.expandInput) {
      input = await fn.expand(denops, input) as string;
    }
    this.input = input;
    this.context.input = input;
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
      sourceArgs(this.options, userSource, this.sources[userSource.name])
    );
  }

  updateOptions(userOptions: UserOptions) {
    this.options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.options,
      userOptions,
    ]);
  }

  async checkUpdated(denops: Denops): Promise<boolean> {
    for (const userSource of this.options.sources) {
      const source = this.sources[userSource.name];

      const [sourceOptions, sourceParams] = sourceArgs(
        this.options,
        userSource,
        source,
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
    if (!this.uis[this.options.ui]) {
      await this.autoload(denops, "ui", this.options.ui);
    }

    const ui = this.uis[this.options.ui];
    if (!ui) {
      if (this.options.ui.length !== 0) {
        await denops.call(
          "ddu#util#print_error",
          `Not found ui: "${this.options.ui}"`,
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
    if (!this.sources[name]) {
      await this.autoload(denops, "source", name);
    }

    const source = this.sources[name];
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
      this.options,
      userSource,
      source,
    );

    return [source, sourceOptions, sourceParams];
  }

  async getFilter(
    denops: Denops,
    name: string,
  ): Promise<
    [
      BaseFilter<BaseFilterParams> | undefined,
      FilterOptions,
      BaseFilterParams,
    ]
  > {
    if (!this.filters[name]) {
      await this.autoload(denops, "filter", name);
    }

    const filter = this.filters[name];
    if (!filter) {
      await denops.call(
        "ddu#util#print_error",
        `Not found filter: ${name}`,
      );
      return [
        undefined,
        defaultFilterOptions(),
        defaultDummy(),
      ];
    }

    const [filterOptions, filterParams] = filterArgs(this.options, filter);
    await checkFilterOnInit(filter, denops, filterOptions, filterParams);

    return [filter, filterOptions, filterParams];
  }

  async getKind(
    denops: Denops,
    name: string,
  ): Promise<
    BaseKind<BaseKindParams> | undefined
  > {
    if (!this.kinds[name]) {
      await this.autoload(denops, "kind", name);
    }

    const kind = this.kinds[name];
    if (!kind) {
      await denops.call(
        "ddu#util#print_error",
        `Not found kind: ${name}`,
      );
      return undefined;
    }

    return kind;
  }

  async getColumn(
    denops: Denops,
    name: string,
  ): Promise<
    [
      BaseColumn<BaseColumnParams> | undefined,
      ColumnOptions,
      BaseColumnParams,
    ]
  > {
    if (!this.columns[name]) {
      await this.autoload(denops, "column", name);
    }

    const column = this.columns[name];
    if (!column) {
      await denops.call(
        "ddu#util#print_error",
        `Not found column: ${name}`,
      );
      return [
        undefined,
        defaultColumnOptions(),
        defaultDummy(),
      ];
    }

    const [columnOptions, columnParams] = columnArgs(this.options, column);
    await checkColumnOnInit(column, denops, columnOptions, columnParams);

    return [column, columnOptions, columnParams];
  }

  private async filterItems(
    denops: Denops,
    userSource: UserSource,
    index: number,
    input: string,
  ): Promise<[boolean, number, DduItem[]]> {
    const source = this.sources[userSource.name];
    const [sourceOptions, _] = sourceArgs(
      this.options,
      userSource,
      source,
    );

    const state = this.gatherStates[index];
    if (!state) {
      return [false, 0, []];
    }

    let items = state.items;
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
    filters: string[],
    input: string,
    items: DduItem[],
  ) {
    for (const filterName of filters) {
      const [filter, filterOptions, filterParams] = await this.getFilter(
        denops,
        filterName,
      );
      if (!filter) {
        continue;
      }

      items = await filter.filter({
        denops,
        options: this.options,
        sourceOptions,
        filterOptions,
        filterParams,
        input,
        items,
      });
    }

    return items;
  }

  private async callColumns(
    denops: Denops,
    columns: string[],
    items: DduItem[],
  ) {
    if (columns.length === 0) {
      return items;
    }

    // Item highlights must be cleared
    for (const item of items) {
      item.highlights = [];
    }

    let startCol = 1;
    for (const columnName of columns) {
      const [column, columnOptions, columnParams] = await this.getColumn(
        denops,
        columnName,
      );
      if (!column) {
        continue;
      }

      const columnLength = await column.getLength({
        denops,
        options: this.options,
        columnOptions,
        columnParams,
        items,
      });

      for (const item of items) {
        const text = await column.getText({
          denops,
          options: this.options,
          columnOptions,
          columnParams,
          startCol,
          endCol: startCol + columnLength,
          item,
        });

        item.display = text.text;

        if (text.highlights && item.highlights) {
          item.highlights = item.highlights.concat(text.highlights);
        }
      }

      startCol += columnLength;
    }
  }

  async getPreviewer(
    denops: Denops,
    item: DduItem,
    actionParams: BaseActionParams,
    previewContext: PreviewContext,
  ): Promise<Previewer | undefined> {
    const source = this.sources[item.__sourceName];
    const kindName = source.kind;

    const kind = await this.getKind(denops, kindName);
    if (!kind || !kind.getPreviewer) {
      return;
    }

    return kind.getPreviewer({
      denops,
      item,
      actionParams,
      previewContext,
    });
  }

  private isExpanded(
    itemTreePath: string,
  ): boolean {
    return Boolean(
      this.expandedPaths.has(itemTreePath),
    );
  }
  private setExpanded(
    itemTreePath: string,
  ): void {
    this.expandedPaths.add(itemTreePath);
  }
  private setUnexpanded(
    itemTreePath: string,
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
  options: DduOptions,
  userSource: UserSource | null,
  source: BaseSource<Params, UserData> | null,
): [SourceOptions, BaseSourceParams] {
  const o = foldMerge(
    mergeSourceOptions,
    defaultSourceOptions,
    [
      options.sourceOptions["_"],
      source ? options.sourceOptions[source.name] : {},
      userSource?.options,
    ],
  );
  const p = foldMerge(mergeSourceParams, defaultDummy, [
    source?.params(),
    options.sourceParams["_"],
    source ? options.sourceParams[source.name] : {},
    userSource?.params,
  ]);
  return [o, p];
}

function filterArgs<
  Params extends BaseFilterParams,
>(
  options: DduOptions,
  filter: BaseFilter<Params>,
): [FilterOptions, BaseFilterParams] {
  const o = foldMerge(
    mergeFilterOptions,
    defaultFilterOptions,
    [
      options.filterOptions["_"],
      options.filterOptions[filter.name],
    ],
  );
  const p = foldMerge(mergeFilterParams, defaultDummy, [
    filter?.params(),
    options.filterParams["_"],
    options.filterParams[filter.name],
  ]);
  return [o, p];
}

function kindArgs<
  Params extends BaseKindParams,
>(
  options: DduOptions,
  kind: BaseKind<Params>,
): [KindOptions, BaseKindParams] {
  const o = foldMerge(
    mergeKindOptions,
    defaultKindOptions,
    [
      options.kindOptions["_"],
      options.kindOptions[kind.name],
    ],
  );
  const p = foldMerge(mergeKindParams, defaultDummy, [
    kind?.params(),
    options.kindParams["_"],
    options.kindParams[kind.name],
  ]);
  return [o, p];
}

function columnArgs<
  Params extends BaseColumnParams,
>(
  options: DduOptions,
  column: BaseColumn<Params>,
): [ColumnOptions, BaseColumnParams] {
  const o = foldMerge(
    mergeColumnOptions,
    defaultColumnOptions,
    [
      options.columnOptions["_"],
      options.columnOptions[column.name],
    ],
  );
  const p = foldMerge(mergeColumnParams, defaultDummy, [
    column?.params(),
    options.columnParams["_"],
    options.columnParams[column.name],
  ]);
  return [o, p];
}

function actionArgs(
  options: DduOptions,
  actionName: string,
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
): Promise<void> {
  if (!source) {
    return;
  }

  source.isInitialized = false;
  await source.onInit({
    denops,
    sourceOptions,
    sourceParams,
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
  lock: Lock<number>,
  context: Context,
  options: DduOptions,
  ui: BaseUi<Params>,
  uiOptions: UiOptions,
  uiParams: Params,
): Promise<void> {
  // NOTE: Redraw must be locked
  await lock.lock(async () => {
    try {
      await ui.redraw({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });
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

async function errorException(denops: Denops, e: unknown, message: string) {
  await denops.call(
    "ddu#util#print_error",
    message,
  );
  if (e instanceof Error) {
    await denops.call(
      "ddu#util#print_error",
      e.message,
    );
    if (e.stack) {
      await denops.call(
        "ddu#util#print_error",
        e.stack,
      );
    }
  }
}

async function globpath(
  denops: Denops,
  search: string,
  file: string,
): Promise<string[]> {
  const runtimepath = await op.runtimepath.getGlobal(denops);

  const check: Record<string, boolean> = {};
  const paths: string[] = [];
  const glob = await fn.globpath(
    denops,
    runtimepath,
    search + file + ".ts",
    1,
    1,
  );

  for (const path of glob) {
    // Skip already added name.
    if (parse(path).name in check) {
      continue;
    }

    paths.push(path);
    check[parse(path).name] = true;
  }

  return paths;
}

function isParentPath(checkPath: string, searchPath: string) {
  return checkPath !== searchPath && searchPath.startsWith(checkPath + pathsep);
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
    ): ReadableStream<Item<Record<never, never>>[]> {
      return new ReadableStream({
        // deno-lint-ignore require-await
        async start(controller) {
          controller.close();
        },
      });
    }
  }
  const source = new S();
  source.name = "strength";
  const [o, p] = sourceArgs(userOptions, null, source);
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
  assertEquals(true, isParentPath("/home", "/home/string"));
  assertEquals(
    true,
    isParentPath(
      "/home/shougo/work/ddu.vim",
      "/home/shougo/work/ddu.vim/denops/ddu/deps.ts",
    ),
  );
  assertEquals(false, isParentPath("hoge", "/home"));
});
