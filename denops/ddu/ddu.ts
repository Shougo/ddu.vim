import { assertEquals, Denops } from "./deps.ts";
import {
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
  DduItem,
  Item,
} from "./types.ts";
import { defaultUiOptions, defaultUiParams } from "./base/ui.ts";
import { defaultSourceOptions, defaultSourceParams } from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";
import { Ui } from "../@ddu-uis/std.ts";
import { Source } from "../@ddu-sources/file.ts";
import { Filter } from "../@ddu-filters/matcher_substring.ts";
import { Kind } from "../@ddu-kinds/file.ts";

export class Ddu {
  private uis: Record<string, BaseUi<Record<string, unknown>>> = {};
  private sources: Record<string, BaseSource<Record<string, unknown>>> = {};
  private filters: Record<string, BaseFilter<Record<string, unknown>>> = {};
  private kinds: Record<string, BaseKind<Record<string, unknown>>> = {};

  constructor() {
    this.uis["std"] = new Ui();
    this.sources["file"] = new Source();
    this.filters["matcher_substring"] = new Filter();
    this.kinds["file"] = new Kind();
  }

  async start(
    denops: Denops,
  ): Promise<void> {
    const sourceItems = await this.sources["file"].gather({
      denops: denops,
      context: {},
      options: {},
      sourceOptions: defaultSourceOptions(),
      sourceParams: defaultSourceParams(),
      completeStr: "",
    });
    const dduItems = sourceItems.map((item: Item) => (
      {
        ...item,
        matcherKey: item.word,
      }
    ));
    const filteredItems = await this.filters["matcher_substring"].filter({
      denops: denops,
      context: {},
      options: {},
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
      options: {},
      kindOptions: defaultKindOptions(),
      kindParams: defaultKindParams(),
      items: items,
    });
  }
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
