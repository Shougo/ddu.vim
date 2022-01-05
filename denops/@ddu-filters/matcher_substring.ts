import { BaseFilter, DduItem } from "../ddu/types.ts";
import { Denops } from "../ddu/deps.ts";

type Params = Record<never, never>;

export class Filter extends BaseFilter<Params> {
  filter(args: {
    denops: Denops;
    input: string;
    items: DduItem[];
  }): Promise<DduItem[]> {
    return Promise.resolve(args.items.filter(
      (item) => item.matcherKey.includes(args.input),
    ));
  }

  params(): Params {
    return {};
  }
}
