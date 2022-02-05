import { assertEquals, Denops, fn, op, parse, toFileUrl } from "./deps.ts";
import {
  ActionFlags,
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
  Context,
  DduExtType,
  DduItem,
  DduOptions,
  FilterOptions,
  Item,
  KindOptions,
  SourceOptions,
  UiOptions,
  UserSource,
} from "./types.ts";
import {
  defaultContext,
  defaultDduOptions,
  foldMerge,
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
import { defaultUiOptions, defaultUiParams } from "./base/ui.ts";
import { defaultSourceOptions, defaultSourceParams } from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";

type GatherState = {
  items: DduItem[];
  done: boolean;
};

export class Ddu {
  private uis: Record<string, BaseUi<Record<string, unknown>>> = {};
  private sources: Record<string, BaseSource<Record<string, unknown>>> = {};
  private filters: Record<string, BaseFilter<Record<string, unknown>>> = {};
  private kinds: Record<string, BaseKind<Record<string, unknown>>> = {};
  private aliases: Record<DduExtType, Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
  };
  private checkPaths: Record<string, boolean> = {};
  private gatherStates: Record<string, GatherState> = {};
  private input = "";
  private context: Context = defaultContext();
  private options: DduOptions = defaultDduOptions();
  private initialized = false;

  async start(
    denops: Denops,
    context: Context,
    options: DduOptions,
    userOptions: Record<string, unknown>,
  ): Promise<void> {
    await this.autoload(denops, "source", options.sources.map((s) => s.name));

    this.context = context;

    if (this.initialized && userOptions?.resume) {
      // Note: sources must not overwrite
      userOptions.sources = this.options.sources;

      this.updateOptions(userOptions);

      if (userOptions?.input != null) {
        this.setInput(userOptions.input as string);
      }

      if (!userOptions?.refresh) {
        // Redraw
        await this.redraw(denops);
        return;
      }
    } else {
      this.options = options;
      this.setInput(this.options.input);
    }

    this.refresh(denops);

    this.initialized = true;
  }

  async refresh(
    denops: Denops,
  ): Promise<void> {
    let index = 0;
    for (const userSource of this.options.sources) {
      const currentIndex = index;
      this.gatherStates[currentIndex] = {
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
      const sourceItems = source.gather({
        denops: denops,
        context: this.context,
        options: this.options,
        sourceOptions: sourceOptions,
        sourceParams: sourceParams,
        input: this.input,
      });

      const reader = sourceItems.getReader();

      const readChunk = async (
        v: ReadableStreamReadResult<Item<unknown>[]>,
      ) => {
        const state = this.gatherStates[currentIndex];

        if (!v.value || v.done) {
          state.done = true;
          return;
        }

        const newItems = v.value.map((item: Item) => {
          const matcherKey = (sourceOptions.matcherKey in item)
            ? (item as Record<string, unknown>)[
              sourceOptions.matcherKey
            ] as string
            : item.word;
          return {
            ...item,
            matcherKey: matcherKey,
            __sourceName: source.name,
          };
        });

        // Update items
        if (state.items.length != 0) {
          state.items = state.items.concat(newItems);
        } else {
          state.items = newItems;
        }

        await this.redraw(denops);

        reader.read().then(readChunk);
      };

      reader.read().then(readChunk);
      index++;
    }
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

    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    ui.refreshItems({
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      items: allItems,
    });

    await ui.redraw({
      denops: denops,
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
    });
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    params: unknown,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    const action = ui.actions[actionName];
    const flags = await action({
      denops: denops,
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      actionParams: params,
    });

    if (flags & ActionFlags.RefreshItems) {
      await this.refresh(denops);
    } else if (flags & ActionFlags.Redraw) {
      await ui.redraw({
        denops: denops,
        context: this.context,
        options: this.options,
        uiOptions: uiOptions,
        uiParams: uiParams,
      });
    }
  }

  async itemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    params: unknown,
  ): Promise<void> {
    const sources = [
      ...new Set(items.map((item) => this.sources[item.__sourceName])),
    ];
    if (sources.length != 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple sources items: "${
          sources.map((source) => source.name)
        }"`,
      );
      return;
    }

    const kinds = [
      ...new Set(sources.map((source) => source.kind)),
    ];
    if (kinds.length != 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple kinds: "${kinds}"`,
      );
      return;
    }

    await this.autoload(denops, "kind", kinds);

    const kindName = kinds[0];
    const kind = this.kinds[kindName];
    if (!kind) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid kind: ${kindName}`,
      );

      return;
    }

    const [kindOptions, kindParams] = kindArgs(this.options, kind);

    // Get default action
    if (actionName == "default") {
      // Use source default action
      const [sourceOptions, _] = sourceArgs(
        this.options,
        null,
        sources[0],
      );
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

    const actions = Object.assign(kind.actions, sources[0].actions);
    if (!actions[actionName]) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid action: ${actionName}`,
      );

      return;
    }

    // Quit UI before action
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    await ui.quit({
      denops: denops,
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
    });

    await actions[actionName]({
      denops: denops,
      options: this.options,
      kindOptions: kindOptions,
      kindParams: kindParams,
      actionParams: params,
      items: items,
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
      return Promise.resolve([]);
    }

    const runtimepath = await op.runtimepath.getGlobal(denops);

    async function globpath(
      searches: string[],
      files: string[],
    ): Promise<string[]> {
      let paths: string[] = [];
      for (const search of searches) {
        for (const file of files) {
          paths = paths.concat(
            await fn.globpath(
              denops,
              runtimepath,
              search + file + ".ts",
              1,
              1,
            ) as string[],
          );
        }
      }

      return Promise.resolve(paths);
    }

    const paths = await globpath(
      [`denops/@ddu-${type}s/`],
      names.map((file) => this.aliases[type][file] ?? file),
    );

    await Promise.all(paths.map(async (path) => {
      await this.register(type, path, parse(path).name);
    }));

    return Promise.resolve(paths);
  }

  setInput(input: string) {
    this.input = input;
  }

  updateOptions(userOptions: Record<string, unknown>) {
    this.options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.options,
      userOptions,
    ]);
  }

  private async getUi(
    denops: Denops,
  ): Promise<
    [BaseUi<Record<string, unknown>>, UiOptions, Record<string, unknown>]
  > {
    await this.autoload(denops, "ui", [this.options.ui]);
    if (!this.uis[this.options.ui]) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid ui: "${this.options.ui}"`,
      );
      return Promise.reject();
    }

    const ui = this.uis[this.options.ui];
    const [uiOptions, uiParams] = uiArgs(
      this.options,
      ui,
    );
    await checkUiOnInit(ui, denops, uiOptions, uiParams);

    return Promise.resolve([ui, uiOptions, uiParams]);
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

    const filters = sourceOptions.matchers.concat(sourceOptions.sorters).concat(
      sourceOptions.converters,
    );
    await this.autoload(denops, "filter", filters);

    let items = this.gatherStates[index].items;
    const maxItems = items.length;
    for (const filterName of filters) {
      const filter = this.filters[filterName];
      if (!filter) {
        await denops.call(
          "ddu#util#print_error",
          `Invalid filter: ${filterName}`,
        );

        continue;
      }

      const [filterOptions, filterParams] = filterArgs(this.options, filter);

      items = await filter.filter({
        denops: denops,
        options: this.options,
        sourceOptions: sourceOptions,
        filterOptions: filterOptions,
        filterParams: filterParams,
        input: input,
        items: items,
      });
    }
    return [this.gatherStates[index].done, maxItems, items];
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
  const p = foldMerge(mergeUiParams, defaultUiParams, [
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
      options.sourceOptions[source.name],
      userSource?.options,
    ],
  );
  const p = foldMerge(mergeSourceParams, defaultSourceParams, [
    source?.params(),
    options.sourceParams["_"],
    options.sourceParams[source.name],
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
  const p = foldMerge(mergeFilterParams, defaultFilterParams, [
    filter?.params(),
    options.sourceParams["_"],
    options.sourceParams[filter.name],
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
  const p = foldMerge(mergeKindParams, defaultKindParams, [
    kind?.params(),
    options.sourceParams["_"],
    options.sourceParams[kind.name],
  ]);
  return [o, p];
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
    console.error(
      `[ddc.vim] ui: ${ui.name} "onInit()" is failed`,
    );
    console.error(e);
  }
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
