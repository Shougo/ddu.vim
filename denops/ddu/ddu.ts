import {
  assertEquals,
  basename,
  Denops,
  dirname,
  echo,
  equal,
  fn,
  Lock,
  op,
  parse,
  toFileUrl,
} from "./deps.ts";
import {
  ActionArguments,
  ActionFlags,
  ActionOptions,
  ActionResult,
  BaseColumn,
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
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
  UserSource,
} from "./types.ts";
import {
  defaultContext,
  defaultDduOptions,
  defaultDummy,
  foldMerge,
  mergeActionOptions,
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
  source: BaseSource<Record<string, unknown>, unknown>;
  kind: BaseKind<Record<string, unknown>>;
  actions: Record<string, unknown>;
};

export class Ddu {
  private uis: Record<string, BaseUi<Record<string, unknown>>> = {};
  private sources: Record<string, BaseSource<Record<string, unknown>>> = {};
  private filters: Record<string, BaseFilter<Record<string, unknown>>> = {};
  private kinds: Record<string, BaseKind<Record<string, unknown>>> = {};
  private columns: Record<string, BaseColumn<Record<string, unknown>>> = {};
  private aliases: Record<DduExtType, Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
  };

  private checkPaths: Record<string, boolean> = {};
  private gatherStates: Record<string, GatherState> = {};
  private input = "";
  private context: Context = defaultContext();
  private options: DduOptions = defaultDduOptions();
  private userOptions: Record<string, unknown> = {};
  private initialized = false;
  private finished = false;
  private lock = new Lock();
  private startTime = 0;
  private expandedPaths = new Set<string>();
  private idsToKeepRedrawsWaiting = new Set<string>();
  private searchPath = "";

  async start(
    denops: Denops,
    aliases: Record<DduExtType, Record<string, string>>,
    context: Context,
    options: DduOptions,
    userOptions: Record<string, unknown>,
  ): Promise<void> {
    const prevInput = this.context.input;

    this.aliases = aliases;
    this.context = context;
    this.userOptions = userOptions;

    const resume = (userOptions?.resume == undefined && this.options?.resume) ||
      userOptions?.resume;

    if (
      this.initialized && resume &&
      (!userOptions?.sources ||
        equal(userOptions.sources, this.options.sources))
    ) {
      // Note: sources must not overwrite
      userOptions.sources = this.options.sources;

      this.updateOptions(userOptions);

      // Set input
      if (userOptions?.input != null) {
        this.setInput(userOptions.input as string);
      } else if (prevInput != "") {
        this.setInput(prevInput);
      }

      const [ui, uiOptions, uiParams] = await this.getUi(denops);
      if (!ui) {
        return;
      }

      if (!this.finished && uiOptions.toggle) {
        await this.uiQuit(denops, ui, uiOptions, uiParams);
        return;
      }

      this.finished = false;

      if (!this.options?.refresh) {
        // NOTE: Enable done to redraw UI properly
        this.context.done = true;

        // UI Redraw only
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
      this.setInput(this.options.input);
    }

    if (this.options.searchPath.length > 0) {
      this.searchPath = this.options.searchPath;
    }

    // Note: UI must be reset.
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }
    if (this.initialized && !this.finished && uiOptions.toggle) {
      await this.uiQuit(denops, ui, uiOptions, uiParams);
      return;
    }

    ui.isInitialized = false;

    this.initialized = false;
    this.finished = false;

    await this.autoload(denops, "source", options.sources.map((s) => s.name));

    // source onInit() must be called before UI
    for (const userSource of this.options.sources) {
      const source = this.sources[userSource.name];
      if (!source) {
        await denops.call(
          "ddu#util#print_error",
          `Invalid source: ${userSource.name}`,
        );
        return;
      }

      const [sourceOptions, sourceParams] = sourceArgs(
        this.options,
        userSource,
        source,
      );
      await this.initSource(
        denops,
        source,
        sourceOptions,
        sourceParams,
      );
    }

    // UI should load before refresh.
    // Note: If UI is blocked until refresh, user input will break UI.
    await this.uiRedraw(denops, []);

    await this.refresh(denops);

    this.initialized = true;
  }

  async refresh(
    denops: Denops,
  ): Promise<void> {
    this.finished = false;

    let index = 0;
    this.startTime = Date.now();
    for (const userSource of this.options.sources) {
      // Check previous gather state
      if (this.gatherStates[index]) {
        this.finished = true;
        while (!this.gatherStates[index].done) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        this.finished = false;
      }

      this.gatherStates[index] = {
        items: [],
        done: false,
      };

      if (!this.sources[userSource.name]) {
        await denops.call(
          "ddu#util#print_error",
          `Invalid source: ${userSource.name}`,
        );

        continue;
      }

      const source = this.sources[userSource.name];
      const [sourceOptions, sourceParams] = sourceArgs(
        this.options,
        userSource,
        source,
      );

      // Call "onRefreshItems" hooks
      const filters = sourceOptions.matchers.concat(
        sourceOptions.sorters,
      ).concat(sourceOptions.converters);
      await this.autoload(denops, "filter", filters);
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

      this.gatherItems(
        denops,
        index,
        source,
        sourceOptions,
        sourceParams,
      );

      index++;
    }
  }

  private newDduItem<
    Params extends Record<string, unknown>,
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
      __expanded: (item.treePath && this.expandedPaths.has(item.treePath)) ||
        (item.isExpanded ?? false),
    };
  }

  async initSource<
    Params extends Record<string, unknown>,
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

  gatherItems<
    Params extends Record<string, unknown>,
    UserData extends unknown,
  >(
    denops: Denops,
    index: number,
    source: BaseSource<Params, UserData>,
    sourceOptions: SourceOptions,
    sourceParams: Params,
  ): void {
    const sourceItems = source.gather({
      denops,
      context: this.context,
      options: this.options,
      sourceOptions,
      sourceParams,
      input: this.input,
    });

    const reader = sourceItems.getReader();

    const readChunk = async (
      v: ReadableStreamDefaultReadResult<Item<unknown>[]>,
    ) => {
      const state = this.gatherStates[index];
      if (!state) {
        reader.cancel();
        return;
      }

      if (this.finished) {
        reader.cancel();
        state.done = true;
        state.items = [];
        // Note: Must return after cancel()
        return;
      }

      if (!v.value || v.done) {
        state.done = true;
        const allDone = Object.values(this.gatherStates).filter(
          (s) => !s.done,
        ).length == 0;
        if (allDone || !this.options.sync) {
          await this.redraw(denops);
        }
        return;
      }

      const newItems = v.value.map((item: Item) =>
        this.newDduItem(
          index,
          source,
          sourceOptions,
          item,
        )
      );

      // Update items
      if (state?.items?.length > 0) {
        state.items = state.items.concat(newItems);
      } else {
        state.items = newItems;
      }
      if (!this.finished && !this.options.sync) {
        await this.redraw(denops);
      }
      this.context.path = sourceOptions.path;
      if (this.context.path == "") {
        // Use current directory instead
        this.context.path = await fn.getcwd(denops) as string;
      }

      reader.read().then(readChunk);
    };

    reader.read().then(readChunk);
  }

  async redraw(
    denops: Denops,
  ): Promise<void> {
    // Update current input
    this.context.done = true;
    this.context.input = this.input;
    this.context.maxItems = 0;

    let allItems: DduItem[] = [];
    let index = 0;
    for (const userSource of this.options.sources) {
      const [done, maxItems, items] = await this.filterItems(
        denops,
        userSource,
        index,
        this.input,
      );
      allItems = allItems.concat(items);
      this.context.done = done && this.context.done;
      this.context.maxItems += maxItems;

      index++;
    }

    if (this.context.done) {
      if (this.options.profile) {
        echo(denops, `Refresh all items: ${Date.now() - this.startTime} ms`);
      }

      const [ui, uiOptions, uiParams] = await this.getUi(denops);
      if (!ui) {
        return;
      }

      const sources = await this.getSourceInfoList(denops);

      await ui.refreshItems({
        denops,
        context: this.context,
        options: this.options,
        uiOptions: uiOptions,
        uiParams: uiParams,
        sources: sources,
        items: allItems,
      });

      const toExpandItems = allItems.filter((item) => item.__expanded);
      if (toExpandItems.length) {
        toExpandItems.forEach((item) =>
          this.expandItem(
            denops,
            item,
            -1,
            ".", // Prevent recursive expanding by missing search arg.
          )
        );
        return;
      }
    }

    await this.uiRedraw(denops, allItems);
  }

  private async getSourceInfoList(denops: Denops): Promise<SourceInfo[]> {
    const sources: SourceInfo[] = [];
    let index = 0;
    for (const userSource of this.options.sources) {
      const source = this.sources[userSource.name];
      if (!source) {
        await denops.call(
          "ddu#util#print_error",
          `Invalid source: ${userSource.name}`,
        );
        continue;
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

      index++;
    }
    return sources;
  }

  async uiRedraw(
    denops: Denops,
    items: DduItem[],
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }

    const sources = await this.getSourceInfoList(denops);

    await ui.refreshItems({
      denops,
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      sources: sources,
      items: items,
    });

    await uiRedraw(
      denops,
      this.lock,
      this.context,
      this.options,
      ui,
      uiOptions,
      uiParams,
    );

    if (this.searchPath.length > 0 && this.context.done) {
      const searchPath = this.searchPath;

      // Prevent infinite loop
      this.searchPath = "";

      const pos = items.findIndex(
        (item) => searchPath == item.treePath ?? item.word,
      );

      if (pos < 0) {
        // NOTE: "searchPath" is not found.  Try expand parents
        const parent = items.find((item) =>
          item.isTree && !item.__expanded && item.treePath &&
          isParentPath(item.treePath, searchPath)
        );

        if (parent) {
          let maxLevel = parent.__level;
          let path = searchPath;
          while (path !== parent.treePath && path != dirname(path)) {
            path = dirname(path);
            maxLevel += 1;
          }

          this.expandItem(denops, parent, maxLevel, searchPath);
          return;
        }
      } else {
        await ui.searchItem({
          denops,
          context: this.context,
          options: this.options,
          uiOptions,
          uiParams,
          item: items[pos],
        });
      }
    }
  }

  async uiQuit<
    Params extends Record<string, unknown>,
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
    this.finished = true;
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
    this.finished = true;
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    params: unknown,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }

    const action = ui.actions[actionName];
    if (!action) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid UI action: ${actionName}`,
      );
      return;
    }
    const flags = await action({
      denops,
      context: this.context,
      options: this.options,
      uiOptions,
      uiParams,
      actionParams: params,
    });

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
      ...new Set(items.map((item) => this.sources[item.__sourceName])),
    ].filter((source) => source);
    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];
    if (sources.length == 0 || sources.length != 1 && indexes.length != 1) {
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
      ...new Set(items.map((item) => item.kind)),
    ] as string[];
    if (kinds.length != 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple kinds: "${kinds}"`,
      );
      return null;
    }

    await this.autoload(denops, "kind", kinds);

    const kindName = kinds[0];
    const kind = this.kinds[kindName];
    if (!kind) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid kind: ${kindName}`,
      );
      return null;
    }

    const [kindOptions, _1] = kindArgs(this.options, kind);
    const [sourceOptions, _2] = sourceArgs(
      this.options,
      this.options.sources[indexes[0]],
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
    params: unknown,
    clipboard: Clipboard,
  ): Promise<void> {
    const ret = await this.getItemActions(denops, items);
    if (!ret) {
      return;
    }
    const { source, kind, actions } = ret;

    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];

    const [sourceOptions, sourceParams] = sourceArgs(
      this.options,
      this.options.sources[indexes[0]],
      source,
    );

    const [kindOptions, kindParams] = kindArgs(this.options, kind);

    // Get default action
    if (actionName == "default") {
      actionName = sourceOptions.defaultAction;
      if (actionName == "") {
        // Use kind default action
        actionName = kindOptions.defaultAction;
      }

      if (actionName == "") {
        await denops.call(
          "ddu#util#print_error",
          `The default action is not defined for the items`,
        );
        return;
      }
    }

    const action = actions[actionName] as (
      args: ActionArguments<Record<string, unknown>>,
    ) => Promise<ActionFlags | ActionResult>;
    if (!action) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid action: ${actionName}`,
      );
      return;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
      return;
    }

    const [actionOptions, _] = actionArgs(this.options, actionName);

    if (actionOptions.quit) {
      // Quit UI before action
      await ui.quit({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
      });
      this.finished = true;
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
          actionParams: params,
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
          actionParams: params,
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
        actionParams: params,
        items,
        clipboard,
      });

      if (typeof (ret) == "object") {
        flags = ret.flags;
        searchPath = ret.searchPath;
      } else {
        flags = ret;
      }

      // Check path is changed by action
      if (sourceOptions.path != prevPath) {
        // Overwrite current path
        const userSource = this.options.sources[indexes[0]];
        if (!userSource.options) {
          userSource.options = sourceOptions;
        }
        userSource.options.path = sourceOptions.path;
        this.context.path = sourceOptions.path;
      }
    }

    if (flags & ActionFlags.RefreshItems) {
      await this.refresh(denops);
    } else if (uiOptions.persist || flags & ActionFlags.Persist) {
      await ui.redraw({
        denops,
        context: this.context,
        options: this.options,
        uiOptions,
        uiParams,
      });
    }

    if (searchPath.length > 0) {
      this.searchPath = searchPath;
    }
  }

  expandItems(
    denops: Denops,
    items: ExpandItem[],
  ): void {
    for (const item of items) {
      const maxLevel = item.maxLevel && item.maxLevel < 0
        ? -1
        : item.item.__level + (item.maxLevel ?? 0);
      this.expandItem(denops, item.item, maxLevel, item.search);
    }
  }

  expandItem(
    denops: Denops,
    parent: DduItem,
    maxLevel: number,
    search?: string,
  ): void {
    if (parent.__level < 0) {
      return;
    }

    if (parent.treePath) {
      this.expandedPaths.add(parent.treePath);
    }
    this.idsToKeepRedrawsWaiting.add(parent.treePath ?? parent.word);
    parent.__expanded = true;

    const index = parent.__sourceIndex;
    const source = this.sources[parent.__sourceName];
    const [sourceOptions, sourceParams] = sourceArgs(
      this.options,
      this.options.sources[index],
      source,
    );

    // Set path
    sourceOptions.path = parent.treePath ?? parent.word;
    this.context.path = sourceOptions.path;

    this.finished = false;

    const sourceItems = source.gather({
      denops,
      context: this.context,
      options: this.options,
      sourceOptions,
      sourceParams,
      input: this.input,
    });

    const reader = sourceItems.getReader();

    let children: DduItem[] = [];

    const readChunk = async (
      v: ReadableStreamDefaultReadResult<Item<unknown>[]>,
    ) => {
      if (this.finished) {
        reader.cancel();
        // Note: Must return after cancel()
        return;
      }

      if (!v.value || v.done) {
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
        if (ui) {
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
        this.idsToKeepRedrawsWaiting.delete(parent.treePath ?? parent.word);
        if (maxLevel < 0 || parent.__level < maxLevel) {
          for (const child of children) {
            // Note: Skip hidden directory
            if (
              child.isTree && child.treePath &&
              !basename(child.treePath).startsWith(".") &&
              (!search || isParentPath(child.treePath, search) ||
                child.__expanded)
            ) {
              // Expand is not completed yet.
              this.expandItem(denops, child, maxLevel, search);
            }
          }
        }
        await this.redrawExpandItem(
          denops,
          parent,
          children,
          search,
        );
        return;
      }

      const newItems = v.value.map((item: Item) =>
        this.newDduItem(
          index,
          source,
          sourceOptions,
          item,
          parent.__level + 1,
        )
      );

      await this.callColumns(
        denops,
        sourceOptions.columns,
        [parent].concat(newItems),
      );

      // Update children
      children = children.concat(newItems);

      reader.read().then(readChunk);
    };

    reader.read().then(readChunk);
  }

  async redrawExpandItem(
    denops: Denops,
    parent: DduItem,
    children: DduItem[],
    search?: string,
  ): Promise<void> {
    // To redraw items, idsToKeepRedrawsWaiting must be empty
    if (this.idsToKeepRedrawsWaiting.size != 0) {
      return;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    if (!ui) {
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

    const searchItem = search
      ? children.find((item) => search == item.treePath ?? item.word)
      : parent;

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

  async collapseItems(
    denops: Denops,
    items: DduItem[],
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

      if (item.treePath) {
        this.expandedPaths.delete(item.treePath);
        [...this.expandedPaths].forEach((v) => {
          if (isParentPath(item.treePath!, v)) {
            this.expandedPaths.delete(v);
          }
        });
      }
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
          const ui = new mod.Ui();
          ui.name = name;
          this.uis[ui.name] = ui;
        };
        break;
      case "source":
        add = (name: string) => {
          const source = new mod.Source();
          source.name = name;
          this.sources[source.name] = source;
        };
        break;
      case "filter":
        add = (name: string) => {
          const filter = new mod.Filter();
          filter.name = name;
          this.filters[filter.name] = filter;
        };
        break;
      case "kind":
        add = (name: string) => {
          const kind = new mod.Kind();
          kind.name = name;
          this.kinds[kind.name] = kind;
        };
        break;
      case "column":
        add = (name: string) => {
          const column = new mod.Column();
          column.name = name;
          this.columns[column.name] = column;
        };
        break;
    }

    add(name);

    // Check alias
    const aliases = Object.keys(this.aliases[type]).filter(
      (k) => this.aliases[type][k] == name,
    );
    for (const alias of aliases) {
      add(alias);
    }
  }

  async autoload(
    denops: Denops,
    type: DduExtType,
    names: string[],
  ): Promise<string[]> {
    if (names.length == 0) {
      return [];
    }

    const paths = await globpath(
      denops,
      [`denops/@ddu-${type}s/`],
      names.map((file) => this.aliases[type][file] ?? file),
    );

    await Promise.all(paths.map(async (path) => {
      await this.register(type, path, parse(path).name);
    }));

    return paths;
  }

  setInput(input: string) {
    this.input = input;
    this.context.input = input;
  }

  getOptions() {
    return this.options;
  }

  getUserOptions() {
    return this.userOptions;
  }

  updateOptions(userOptions: Record<string, unknown>) {
    this.options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.options,
      userOptions,
    ]);
    if (this.options.searchPath.length > 0) {
      this.searchPath = this.options.searchPath;
    }
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
      BaseUi<Record<string, unknown>> | undefined,
      UiOptions,
      Record<string, unknown>,
    ]
  > {
    if (!this.uis[this.options.ui]) {
      await this.autoload(denops, "ui", [this.options.ui]);
    }
    const ui = this.uis[this.options.ui];
    if (!ui) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid ui: "${this.options.ui}"`,
      );
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

  private async getFilter(
    denops: Denops,
    filterName: string,
  ): Promise<
    [
      BaseFilter<Record<string, unknown>> | undefined,
      FilterOptions,
      Record<string, unknown>,
    ]
  > {
    const filter = this.filters[filterName];
    if (!filter) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid filter: ${filterName}`,
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

    await this.callColumns(denops, sourceOptions.columns, items);

    return [state.done, allItems, items];
  }

  private async callFilters(
    denops: Denops,
    sourceOptions: SourceOptions,
    filters: string[],
    input: string,
    items: DduItem[],
  ) {
    await this.autoload(denops, "filter", filters);
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
    if (columns.length == 0) {
      return items;
    }

    await this.autoload(denops, "column", columns);

    // Item highlights must be cleared
    for (const item of items) {
      item.highlights = [];
    }

    let startCol = 1;
    for (const columnName of columns) {
      const column = this.columns[columnName];
      if (!column) {
        await denops.call(
          "ddu#util#print_error",
          `Invalid column: ${columnName}`,
        );
        continue;
      }

      const [columnOptions, columnParams] = columnArgs(this.options, column);

      await checkColumnOnInit(column, denops, columnOptions, columnParams);

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
    actionParams: unknown,
    previewContext: PreviewContext,
  ): Promise<Previewer | undefined> {
    const source = this.sources[item.__sourceName];
    const kindName = source.kind;

    await this.autoload(denops, "kind", [kindName]);

    const kind = this.kinds[kindName];
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
}

function uiArgs<
  Params extends Record<string, unknown>,
>(
  options: DduOptions,
  ui: BaseUi<Params>,
): [UiOptions, Record<string, unknown>] {
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
  Params extends Record<string, unknown>,
  UserData extends unknown,
>(
  options: DduOptions,
  userSource: UserSource | null,
  source: BaseSource<Params, UserData>,
): [SourceOptions, Record<string, unknown>] {
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
  Params extends Record<string, unknown>,
>(
  options: DduOptions,
  filter: BaseFilter<Params>,
): [FilterOptions, Record<string, unknown>] {
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

function columnArgs<
  Params extends Record<string, unknown>,
>(
  options: DduOptions,
  column: BaseColumn<Params>,
): [ColumnOptions, Record<string, unknown>] {
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

function kindArgs<
  Params extends Record<string, unknown>,
>(
  options: DduOptions,
  kind: BaseKind<Params>,
): [KindOptions, Record<string, unknown>] {
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

function actionArgs(
  options: DduOptions,
  actionName: string,
): [ActionOptions, Record<string, unknown>] {
  const o = foldMerge(
    mergeActionOptions,
    defaultActionOptions,
    [
      options.actionOptions["_"],
      options.actionOptions[actionName],
    ],
  );
  return [o, {}];
}

async function checkUiOnInit(
  ui: BaseUi<Record<string, unknown>>,
  denops: Denops,
  uiOptions: UiOptions,
  uiParams: Record<string, unknown>,
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
  Params extends Record<string, unknown>,
>(
  denops: Denops,
  lock: Lock,
  context: Context,
  options: DduOptions,
  ui: BaseUi<Params>,
  uiOptions: UiOptions,
  uiParams: Params,
): Promise<void> {
  // Note: redraw must be locked
  await lock.with(async () => {
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
        // Note: It may be called on invalid state
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
  filter: BaseFilter<Record<string, unknown>>,
  denops: Denops,
  filterOptions: FilterOptions,
  filterParams: Record<string, unknown>,
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
  column: BaseColumn<Record<string, unknown>>,
  denops: Denops,
  columnOptions: FilterOptions,
  columnParams: Record<string, unknown>,
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
  searches: string[],
  files: string[],
): Promise<string[]> {
  const runtimepath = await op.runtimepath.getGlobal(denops);

  const check: Record<string, boolean> = {};
  const paths: string[] = [];
  for (const search of searches) {
    for (const file of files) {
      const glob = await fn.globpath(
        denops,
        runtimepath,
        search + file + ".ts",
        1,
        1,
      ) as string[];

      for (const path of glob) {
        // Skip already added name.
        if (parse(path).name in check) {
          continue;
        }

        paths.push(path);
        check[parse(path).name] = true;
      }
    }
  }

  return paths;
}

function isParentPath(checkPath: string, searchPath: string) {
  let path = dirname(searchPath);
  while (path !== checkPath && path != dirname(path)) {
    path = dirname(path);
  }
  return path === checkPath;
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
