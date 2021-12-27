import { BaseFilter, DduCandidate } from "../ddu/types.ts";
import { Denops } from "../ddu/deps.ts";

export class Filter extends BaseFilter<{}> {
  filter(args: {
    denops: Denops;
    completeStr: string;
    candidates: DduCandidate[];
  }): Promise<DduCandidate[]> {
    return Promise.resolve(args.candidates.filter(
      (candidate) => candidate.matcherKey.includes(args.completeStr),
    ));
  }

  params(): {} {
    return {};
  }
}
