import { assertEquals } from "@std/assert/equals";

import { BaseSource, defaultSourceOptions } from "../base/source.ts";
import { GatherState } from "../state.ts";
import type { BaseParams, DduItem } from "../types.ts";

Deno.test("GatherState retains and emits a large source chunk in order", async () => {
  const item: DduItem = {
    word: "item",
    matcherKey: "item",
    __sourceIndex: 0,
    __sourceName: "test",
    __level: 0,
    __expanded: false,
    __columnTexts: {},
    __groupedPath: "",
  };
  const chunkSize = 200_000;
  const source = new class extends BaseSource<BaseParams> {
    override gather(): ReadableStream<DduItem[]> {
      return ReadableStream.from([
        [{ ...item, word: "first" }],
        new Array<DduItem>(chunkSize).fill(item),
        [{ ...item, word: "last" }],
      ]);
    }

    override params(): BaseParams {
      return {};
    }
  }();
  const state = new GatherState({
    sourceIndex: 0,
    source,
    sourceOptions: defaultSourceOptions(),
    sourceParams: source.params(),
  }, source.gather());

  const chunks = await Array.fromAsync(state.itemsStream);
  await state.waitDone;
  assertEquals(chunks.map((chunk) => chunk.length), [1, chunkSize, 1]);
  assertEquals(state.items.length, chunkSize + 2);
  assertEquals(state.items[0].word, "first");
  assertEquals(state.items[chunkSize].word, "item");
  assertEquals(state.items[chunkSize + 1].word, "last");
});
