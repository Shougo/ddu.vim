import { assertEquals, Denops, fn, op, parse, toFileUrl } from "./deps.ts";
import {
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
  DduItem,
  DduOptions,
  Item,
  SourceOptions,
  UserSource,
} from "./types.ts";
import {
  defaultDduOptions,
  foldMerge,
  mergeSourceOptions,
  mergeSourceParams,
} from "./context.ts";
import { defaultUiOptions, defaultUiParams } from "./base/ui.ts";
import { defaultSourceOptions, defaultSourceParams } from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";
import { Ui } from "../@ddu-uis/std.ts";
import { Kind } from "../@ddu-kinds/file.ts";

export class Ddu {
  private uis: Record<string, BaseUi<Record<string, unknown>>> = {};
  private sources: Record<string, BaseSource<Record<string, unknown>>> = {};
  private filters: Record<string, BaseFilter<Record<string, unknown>>> = {};
  private kinds: Record<string, BaseKind<Record<string, unknown>>> = {};
  private aliasSources: Record<string, string> = {};
  private aliasFilters: Record<string, string> = {};
  private checkPaths: Record<string, boolean> = {};
  private items: DduItem[] = [];
  private options: DduOptions = defaultDduOptions();

  constructor() {
    this.uis["std"] = new Ui();
    this.kinds["file"] = new Kind();
  }

  async start(
    denops: Denops,
    options: DduOptions,
  ): Promise<void> {
    await this.autoload(denops, options.sources.map((s) => s.name), [
      "matcher_substring",
    ]);

    this.items = [];
    this.options = options;

    for (const userSource of options.sources) {
      const source = this.sources[userSource.name];
      const [sourceOptions, sourceParams] = sourceArgs(
        options,
        userSource,
        source,
      );
      const sourceItems = source.gather({
        denops: denops,
        context: {},
        options: this.options,
        sourceOptions: sourceOptions,
        sourceParams: sourceParams,
        input: "",
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
          };
        });

        this.items = this.items.concat(newItems);

        await this.narrow(denops, this.options.input);

        reader.read().then(readChunk);
      };

      reader.read().then(readChunk);
    }
  }

  async narrow(
    denops: Denops,
    input: string,
  ): Promise<void> {
    const filteredItems = await this.filters["matcher_substring"].filter({
      denops: denops,
      context: {},
      options: this.options,
      sourceOptions: defaultSourceOptions(),
      filterOptions: defaultFilterOptions(),
      filterParams: defaultFilterParams(),
      input: input,
      items: this.items,
    });

    await this.uis["std"].redraw({
      denops: denops,
      options: this.options,
      uiOptions: defaultUiOptions(),
      uiParams: defaultUiParams(),
      items: filteredItems,
    });
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    params: unknown,
  ): Promise<void> {
    const action = this.uis["std"].actions[actionName];
    await action({
      denops: denops,
      context: {},
      options: defaultDduOptions(),
      uiOptions: defaultUiOptions(),
      uiParams: defaultUiParams(),
      actionParams: params,
    });
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
    const action = this.kinds["file"].actions[actionName];
    await action({
      denops: denops,
      context: {},
      options: defaultDduOptions(),
      kindOptions: defaultKindOptions(),
      kindParams: defaultKindParams(),
      actionParams: params,
      items: items,
    });
  }

  async registerSource(path: string, name: string) {
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    const addSource = (name: string) => {
      const source = new mod.Source();
      source.name = name;
      this.sources[source.name] = source;
    };

    addSource(name);

    // Check alias
    const aliases = Object.keys(this.aliasSources).filter(
      (k) => this.aliasSources[k] == name,
    );
    for (const alias of aliases) {
      addSource(alias);
    }
  }

  async registerFilter(path: string, name: string) {
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    const addFilter = (name: string) => {
      const filter = new mod.Filter();
      filter.name = name;
      this.filters[filter.name] = filter;
    };

    addFilter(name);

    // Check alias
    const aliases = Object.keys(this.aliasFilters).filter(
      (k) => this.aliasFilters[k] == name,
    );
    for (const alias of aliases) {
      addFilter(alias);
    }
  }

  async autoload(
    denops: Denops,
    sourceNames: string[],
    filterNames: string[],
  ): Promise<string[]> {
    if (sourceNames.length == 0 && filterNames.length == 0) {
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

    const sources = (await globpath(
      ["denops/@ddu-sources/"],
      sourceNames.map((file) => this.aliasSources[file] ?? file),
    )).filter((path) => !(path in this.checkPaths));

    const filters = (await globpath(
      ["denops/@ddu-filters/"],
      filterNames.map((file) => this.aliasFilters[file] ?? file),
    )).filter((path) => !(path in this.checkPaths));

    await Promise.all(sources.map(async (path) => {
      await this.registerSource(path, parse(path).name);
    }));
    await Promise.all(filters.map(async (path) => {
      await this.registerFilter(path, parse(path).name);
    }));

    return Promise.resolve(sources.concat(filters));
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
    options.sourceParams[source.name],
    userSource.params,
  ]);
  return [o, p];
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
