import { assertEquals, Denops } from "./deps.ts";
import { Ui } from "../@ddu-uis/default.ts";

export class Ddu {
  async start(
    denops: Denops,
  ): Promise<void> {
    const ui = new Ui();
    await ui.redraw({
      denops: denops,
      candidates: [{ word: "foobar", matcherKey: "foobar" }],
    });
  }
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
