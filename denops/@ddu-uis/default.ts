import { BaseUi } from "../ddu/types.ts";
import { fn, Denops } from "../ddu/deps.ts";

export class Ui extends BaseUi<{}> {
  async redraw(args: {
    denops: Denops,
  }): Promise<void> {
    await fn.setline(args.denops, ".", "foobar")
  }

  params(): {} {
    return {};
  }
}
