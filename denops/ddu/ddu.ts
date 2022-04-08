import { assertEquals, Denops, fn, op, parse, toFileUrl } from "./deps.ts";
import {
  ActionFlags,
  ActionOptions,
  Actions,
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
  Context,
  DduEvent,
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
  mergeActionOptions,
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
import {
  defaultSourceOptions,
  defaultSourceParams,
  GatherArguments,
} from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";
import { defaultActionOptions } from "./base/action.ts";
import { Lock } from "https://deno.land/x/async@v1.1.5/mod.ts";

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
  private userOptions: Record<string, unknown> = {};
  private initialized = false;
  private finished = false;
  private lock = new Lock();
  private startTime = 0;

  async start(
    denops: Denops,
    aliases: Record<DduExtType, Record<string, string>>,
    context: Context,
    options: DduOptions,
    userOptions: Record<string, unknown>,
  ): Promise<void> {
    this.aliases = aliases;
    this.context = context;
    this.userOptions = userOptions;

    await this.autoload(denops, "source", options.sources.map((s) => s.name));

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

    // Note: UI must be reset.
    const [ui, _1, _2] = await this.getUi(denops);
    ui.isInitialized = false;

    this.initialized = false;

    this.refresh(denops);

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

      await this.gatherItems(
        denops,
        index,
        source,
        sourceOptions,
        sourceParams,
      );

      index++;
    }
  }

  async gatherItems<
    Params extends Record<string, unknown>,
    UserData extends unknown,
  >(
    denops: Denops,
    index: number,
    source: BaseSource<Params, UserData>,
    sourceOptions: SourceOptions,
    sourceParams: Params,
  ): Promise<void> {
    if (!this.initialized) {
      await source.onInit({
        denops,
        sourceOptions,
        sourceParams,
      });
    }

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
      const state = this.gatherStates[index];

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

      const newItems = v.value.map((item: Item) => {
        const matcherKey = (sourceOptions.matcherKey in item)
          ? (item as Record<string, unknown>)[
            sourceOptions.matcherKey
          ] as string
          : item.word;
        return {
          ...item,
          matcherKey: matcherKey,
          __sourceIndex: index,
          __sourceName: source.name,
        };
      });

      // Update items
      if (state.items.length != 0) {
        state.items = state.items.concat(newItems);
        if (!this.finished && !this.options.sync) {
          await this.redraw(denops);
        }
      } else {
        state.items = newItems;
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

    if (this.context.done && this.options.profile) {
      console.log(`Refresh all items: ${Date.now() - this.startTime} ms`);
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    ui.refreshItems({
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      items: allItems,
    });

    // Note: redraw must be locked
    await this.lock.with(async () => {
      try {
        await ui.redraw({
          denops: denops,
          context: this.context,
          options: this.options,
          uiOptions: uiOptions,
          uiParams: uiParams,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes(" E523: ")) {
          // Note: It may be called on invalid state
          // Ignore "E523: Not allowed here" errors
          await denops.call("ddu#_lazy_redraw", this.options.name);
        } else {
          console.error(
            `[ddc.vim] ui: ${ui.name} "redraw()" is failed`,
          );
          console.error(e);
        }
      }
    });
  }

  async onEvent(
    denops: Denops,
    event: DduEvent,
  ): Promise<void> {
    for (const userSource of this.options.sources) {
      const source = this.sources[userSource.name];
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

  async getItemActions(
    denops: Denops,
    items: DduItem[],
  ): Promise<Actions<Record<string, unknown>> | null> {
    const sources = [
      ...new Set(items.map((item) => this.sources[item.__sourceName])),
    ];
    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];
    if (sources.length != 1 && indexes.length != 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple sources items: "${
          sources.map((source) => source.name)
        }"`,
      );
      return null;
    }
    const source = sources[0];

    const kinds = [
      ...new Set(sources.map((source) => source.kind)),
    ];
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

    return Object.assign(
      kind.actions,
      kindOptions.actions,
      source.actions,
      sourceOptions.actions,
    );
  }

  async itemAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    params: unknown,
  ): Promise<void> {
    const actions = await this.getItemActions(denops, items);
    if (!actions) {
      // Error
      return;
    }

    const sources = [
      ...new Set(items.map((item) => this.sources[item.__sourceName])),
    ];
    const indexes = [
      ...new Set(items.map((item) => item.__sourceIndex)),
    ];

    const [sourceOptions, sourceParams] = sourceArgs(
      this.options,
      this.options.sources[indexes[0]],
      sources[0],
    );

    const kinds = [
      ...new Set(sources.map((source) => source.kind)),
    ];
    const kindName = kinds[0];
    const kind = this.kinds[kindName];

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

    const action = actions[actionName];
    if (!action) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid action: ${actionName}`,
      );
      return;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    const [actionOptions, _] = actionArgs(this.options, actionName);

    if (actionOptions.quit) {
      // Quit UI before action
      await ui.quit({
        denops: denops,
        context: this.context,
        options: this.options,
        uiOptions: uiOptions,
        uiParams: uiParams,
      });
    }

    let flags: ActionFlags;
    if (sourceOptions.actions[actionName]) {
      flags = await denops.call(
        "denops#callback#call",
        sourceOptions.actions[actionName],
        {
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
          options: this.options,
          actionParams: params,
          items: items,
        },
      ) as ActionFlags;
    } else {
      const prevPath = sourceOptions.path;
      flags = await action({
        denops: denops,
        options: this.options,
        sourceOptions: sourceOptions,
        sourceParams: sourceParams,
        kindOptions: kindOptions,
        kindParams: kindParams,
        actionParams: params,
        items: items,
      });

      // Check path is changed by action
      if (sourceOptions.path != prevPath) {
        // Overwrite current path
        const userSource = this.options.sources[indexes[0]];
        if (!userSource.options) {
          userSource.options = defaultSourceOptions();
        }
        userSource.options.path = sourceOptions.path;
      }
    }

    if (flags & ActionFlags.RefreshItems) {
      await this.refresh(denops);
    } else if (flags & ActionFlags.Persist) {
      await ui.redraw({
        denops: denops,
        context: this.context,
        options: this.options,
        uiOptions: uiOptions,
        uiParams: uiParams,
      });
    }
  }

  async expandItem(
    denops: Denops,
    item: DduItem,
  ): Promise<void> {
    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    ui.refreshItems({
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      items: [],
    });

    // Note: redraw must be locked
    await this.lock.with(async () => {
      try {
        await ui.redraw({
          denops: denops,
          context: this.context,
          options: this.options,
          uiOptions: uiOptions,
          uiParams: uiParams,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes(" E523: ")) {
          // Note: It may be called on invalid state
          // Ignore "E523: Not allowed here" errors
          await denops.call("ddu#_lazy_redraw", this.options.name);
        } else {
          console.error(
            `[ddc.vim] ui: ${ui.name} "redraw()" is failed`,
          );
          console.error(e);
        }
      }
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

    let items = this.gatherStates[index].items;
    const allItems = items.length;

    const callFilters = async (
      filters: string[],
      input: string,
      items: DduItem[],
    ) => {
      await this.autoload(denops, "filter", filters);
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

      return items;
    };

    items = await callFilters(sourceOptions.matchers, input, items);

    items = await callFilters(sourceOptions.sorters, input, items);

    // Truncate before converters
    if (items.length > sourceOptions.maxItems) {
      items = items.slice(0, sourceOptions.maxItems);
    }

    items = await callFilters(sourceOptions.converters, input, items);

    return [this.gatherStates[index].done, allItems, items];
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
    options.filterParams["_"],
    options.filterParams[filter.name],
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
    console.error(
      `[ddc.vim] ui: ${ui.name} "onInit()" is failed`,
    );
    console.error(e);
  }
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
    ...defaultSourceParams(),
    by_: "bar",
    min: 100,
    max: 999,
  });
});
