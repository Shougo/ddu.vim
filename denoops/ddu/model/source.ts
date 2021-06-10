import { Item, Source } from "./mod.ts";
import { delay } from "https://deno.land/std/async/delay.ts";

export class NumberItem implements Item {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  idx(): number {
    return this.n;
  }
  value(): string {
    return this.n.toString();
  }
  valueType(): string {
    return "number";
  }
  view(): string {
    return this.n.toString();
  }
  viewForMatcing(): string {
    return this.view();
  }
}

export class NumberSource implements Source {
  name = "Number";
  start(_option: Record<string, unknown>): AsyncIterableIterator<NumberItem> {
    // generatorからAsyncIterableIteratorこれでいいのか?わからん
    const gen = tmpGenerator();
    gen[Symbol.asyncIterator] = () => gen;
    return gen;
  }
}

async function* tmpGenerator() {
  for (let i = 0; true; ++i) {
    const item = new NumberItem(i);
    yield item;
    await delay(0); // 専有してしまうので他のタスクに譲る
  }
}
