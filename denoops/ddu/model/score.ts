import { Item, Match, Score } from "./mod.ts";
import { NumberItem } from "./source.ts";
import { delay } from "https://deno.land/std/async/delay.ts";

export async function* scoreStream(
  itemStream: AsyncIterableIterator<Item>,
  match: Match,
) {
  for await (const item of itemStream) {
    const score = match.score(item);
    const scored = new Scored(item, score);
    yield scored;
    await delay(0);
  }
}

// typescriptの標準tupleは?
export class Scored {
  item: Item;
  score: Score;
  constructor(item: Item, score: Score) {
    this.item = item;
    this.score = score;
  }
}

export class Even implements Match {
  name = "Even";
  start(_query: string, _option: Record<string, unknown>): void {
  }
  score(item: NumberItem): Score {
    const n = parseInt(item.value(), 10);
    if (n % 3 == 0) {
      return [];
    }
    return [-1 * Math.floor(n / 3), item.idx()];
  }
}
