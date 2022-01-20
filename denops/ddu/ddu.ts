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
  Item,
  SourceOptions,
  UiOptions,
  UserSource,
} from "./types.ts";
import {
  defaultContext,
  defaultDduOptions,
  foldMerge,
  mergeSourceOptions,
  mergeSourceParams,
  mergeUiOptions,
  mergeUiParams,
} from "./context.ts";
import { defaultUiOptions, defaultUiParams } from "./base/ui.ts";
import { defaultSourceOptions, defaultSourceParams } from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";

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
  private items: Record<string, DduItem[]> = {};
  private input = "";
  private context: Context = defaultContext();
  private options: DduOptions = defaultDduOptions();

  async start(
    denops: Denops,
    context: Context,
    options: DduOptions,
  ): Promise<void> {
    await this.autoload(denops, "source", options.sources.map((s) => s.name));

    this.context = context;
    this.options = options;
    this.input = this.options.input;

    let index = 0;
    for (const userSource of options.sources) {
      const currentIndex = index;
      this.items[currentIndex] = [];

      const source = this.sources[userSource.name];
      const [sourceOptions, sourceParams] = sourceArgs(
        options,
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
        if (!v.value || v.done) {
          return;
        }

        const newItems = v.value.map((item: Item) => {
          const matcherKey = (sourceOptions.matcherKey in item)
            ? (item as Record<string, string>)[sourceOptions.matcherKey]
            : item.word;
          return {
            ...item,
            matcherKey: matcherKey,
            __sourceName: source.name,
          };
        });

        // Update items
        this.items[currentIndex] = this.items[currentIndex].concat(newItems);

        await this.narrow(denops, this.input);

        reader.read().then(readChunk);
      };

      reader.read().then(readChunk);
      index++;
    }
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
        `Invalid ui is detected: "${this.options.ui}"`,
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
  ): Promise<DduItem[]> {
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

    let items = this.items[index];
    for (const filterName of filters) {
      items = await this.filters[filterName].filter({
        denops: denops,
        options: this.options,
        sourceOptions: sourceOptions,
        filterOptions: defaultFilterOptions(),
        filterParams: defaultFilterParams(),
        input: input,
        items: items,
      });
    }
    return items;
  }

  async narrow(
    denops: Denops,
    input: string,
  ): Promise<void> {
    // Update current input
    this.input = input;

    let items: DduItem[] = [];
    let index = 0;
    for (const userSource of this.options.sources) {
      items = items.concat(
        await this.filterItems(
          denops,
          userSource,
          index,
          this.input,
        ),
      );
      index++;
    }

    const [ui, uiOptions, uiParams] = await this.getUi(denops);

    ui.refreshItems({
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
      items: items,
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
      await this.narrow(denops, this.input);
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

  async doAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    params: unknown,
  ): Promise<void> {
    if (actionName == "default") {
      // Use default action
      actionName = "open";
    }

    const kinds = [
      ...new Set(items.map((item) => this.sources[item.__sourceName].kind)),
    ];
    if (kinds.length != 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple kinds: "${kinds}"`,
      );
      return;
    }

    await this.autoload(denops, "kind", kinds);

    // Quit UI before action
    const [ui, uiOptions, uiParams] = await this.getUi(denops);
    await ui.quit({
      denops: denops,
      context: this.context,
      options: this.options,
      uiOptions: uiOptions,
      uiParams: uiParams,
    });

    const action = this.kinds[kinds[0]].actions[actionName];
    await action({
      denops: denops,
      options: defaultDduOptions(),
      kindOptions: defaultKindOptions(),
      kindParams: defaultKindParams(),
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
}

function sourceArgs<
  Params extends Record<string, unknown>,
  UserData extends unknown,
>(
  options: DduOptions,
  userSource: UserSource,
  source: BaseSource<Params, UserData>,
): [SourceOptions, Record<string, unknown>] {
  const o = foldMerge(
    mergeSourceOptions,
    defaultSourceOptions,
    [
      options.sourceOptions["_"],
      options.sourceOptions[source.name],
      userSource.options,
    ],
  );
  const p = foldMerge(mergeSourceParams, defaultSourceParams, [
    source.params ? source.params() : null,
    options.sourceParams["_"],
    options.sourceParams[source.name],
    userSource.params,
  ]);
  return [o, p];
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
    ui.params ? ui.params() : null,
    options.uiParams["_"],
    options.uiParams[ui.name],
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
