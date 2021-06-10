// deno標準のnullable何使えばいいの
export type Nullable<T> = null | T;

export interface Item {
  idx(): number;
  value(): string;
  valueType(): string;
  // A single line of text to be displayed in the candidate list
  view(): string;
  // This is used for matching. It should be substring of view.
  // view_for_matcing(): string { this.view() }
  viewForMatcing(): string;
}

export interface Source {
  name: string;
  start(option: Record<string, unknown>): AsyncIterableIterator<Item>;
}

export interface Match {
  name: string;
  start(query: string, option: Record<string, unknown>): void;
  score(item: Item): Score;
}

// If empty, item is excluded. Two scores MUST be a same length to compare.
// Smaller score will be sorted to smaller index.
export type Score = number[];

export function shouldBeExcluded(score: Score): boolean {
  return !score.length; // empty
}

export function cmp(a: Score, b: Score): number {
  for (let i = 0; i < Math.min(a.length, b.length); ++i) {
    if (a[i] == b[i]) continue;
    return a[i] - b[i];
  }
  return 0;
}
