import { assertEquals, Denops } from "./deps.ts";
import { DduItem, Item } from "./types.ts";
import { Ui } from "../@ddu-uis/std.ts";
import { Source } from "../@ddu-sources/file.ts";
import { Filter } from "../@ddu-filters/matcher_substring.ts";
import { Kind } from "../@ddu-kinds/file.ts";

export class Ddu {
  async start(
    denops: Denops,
  ): Promise<void> {
    const ui = new Ui();
    const source = new Source();
    const filter = new Filter();

    const sourceItems = await source.gather({ denops: denops });
    const dduItems = sourceItems.map((item: Item) => (
      {
        ...item,
        matcherKey: item.word,
      }
    ));
    const filteredItems = await filter.filter({
      denops: denops,
      completeStr: "",
      items: dduItems,
    });

    await ui.redraw({
      denops: denops,
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

    const kind = new Kind();

    // Call action
    if (actionName == "default") {
      // Use default action
      actionName = "open";
    }
    const action = kind.actions[actionName];
    await action({ denops: denops, items: items });
  }
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
