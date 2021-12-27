import { BaseUi, DduItem } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";

export class Ui extends BaseUi<{}> {
  async redraw(args: {
    denops: Denops;
    items: DduItem[];
  }): Promise<void> {
    await fn.setline(args.denops, 1, args.items.map((c) => c.word));
  }

  params(): {} {
    return {};
  }
}
