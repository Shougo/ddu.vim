import { assertEquals, Denops } from "./deps.ts";
import {
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
  DduItem,
  DduOptions,
  Item,
} from "./types.ts";
import { defaultDduOptions } from "./context.ts";
import { defaultUiOptions, defaultUiParams } from "./base/ui.ts";
import { defaultSourceOptions, defaultSourceParams } from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";
import { Ui } from "../@ddu-uis/std.ts";
import { Source as File } from "../@ddu-sources/file.ts";
import { Source as FileRec } from "../@ddu-sources/file_rec.ts";
import { Filter } from "../@ddu-filters/matcher_substring.ts";
import { Kind } from "../@ddu-kinds/file.ts";

export class Ddu {
  private uis: Record<string, BaseUi<Record<string, unknown>>> = {};
  private sources: Record<string, BaseSource<Record<string, unknown>>> = {};
  private filters: Record<string, BaseFilter<Record<string, unknown>>> = {};
  private kinds: Record<string, BaseKind<Record<string, unknown>>> = {};

  constructor() {
    this.uis["std"] = new Ui();
    this.sources["file"] = new File();
    this.sources["file_rec"] = new FileRec();
    this.filters["matcher_substring"] = new Filter();
    this.kinds["file"] = new Kind();
  }

  async start(
    denops: Denops,
    options: DduOptions,
  ): Promise<void> {
    let dduItems: DduItem[] = [];

    for (const sourceName of options.sources) {
      const sourceOptions = defaultSourceOptions();
      const sourceItems = await this.sources[sourceName].gather({
        denops: denops,
        context: {},
        options: options,
        sourceOptions: sourceOptions,
        sourceParams: defaultSourceParams(),
        completeStr: "",
      });

      const reader = sourceItems.getReader();
      reader.read().then(async ({ done, value }) => {
        if (!value || done) {
          return;
        }

        const newItems = value.map((item: Item) => {
          const matcherKey = (sourceOptions.matcherKey in item)
            ? (item as Record<string, string>)[sourceOptions.matcherKey]
            : item.word;
          return {
            ...item,
            matcherKey: matcherKey,
          };
        });

        dduItems = dduItems.concat(newItems);

        const filteredItems = await this.filters["matcher_substring"].filter({
          denops: denops,
          context: {},
          options: options,
          sourceOptions: defaultSourceOptions(),
          filterOptions: defaultFilterOptions(),
          filterParams: defaultFilterParams(),
          completeStr: "",
          items: dduItems,
        });

        await this.uis["std"].redraw({
          denops: denops,
          uiOptions: defaultUiOptions(),
          uiParams: defaultUiParams(),
          items: filteredItems,
        });
      });
    }
  }

  async doAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    options: unknown,
  ): Promise<void> {
    console.log(actionName);
    console.log(items);
    console.log(options);

    // Call action
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
      items: items,
    });
  }
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
