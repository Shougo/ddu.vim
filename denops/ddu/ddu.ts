import { assertEquals, Denops } from "./deps.ts";
import { Item } from "./types.ts";
import { Ui } from "../@ddu-uis/default.ts";
import { Source } from "../@ddu-sources/file.ts";
import { Filter } from "../@ddu-filters/matcher_substring.ts";

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
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
