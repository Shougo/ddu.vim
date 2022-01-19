import { BaseFilter, DduItem, SourceOptions } from "../ddu/types.ts";
import { Denops } from "../ddu/deps.ts";

type Params = Record<never, never>;

export class Filter extends BaseFilter<Params> {
  filter(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    input: string;
    items: DduItem[];
  }): Promise<DduItem[]> {
    const input = args.sourceOptions.ignoreCase
      ? args.input.toLowerCase()
      : args.input;
    return Promise.resolve(args.items.filter(
      (item) =>
        args.sourceOptions.ignoreCase
          ? item.matcherKey.toLowerCase().includes(input)
          : item.matcherKey.includes(input),
    ));
  }

  params(): Params {
    return {};
  }
}
