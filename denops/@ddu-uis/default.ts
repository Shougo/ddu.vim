import { BaseUi, DduCandidate } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";

export class Ui extends BaseUi<{}> {
  async redraw(args: {
    denops: Denops;
    candidates: DduCandidate[];
  }): Promise<void> {
    await fn.setline(args.denops, 1, args.candidates.map((c) => c.word));
  }

  params(): {} {
    return {};
  }
}
