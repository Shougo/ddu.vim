import { BaseUi, DduItem } from "../ddu/types.ts";
import { Denops, fn, vars } from "../ddu/deps.ts";

export class Ui extends BaseUi<{}> {
  async redraw(args: {
    denops: Denops;
    items: DduItem[];
  }): Promise<void> {
    await fn.setline(args.denops, 1, args.items.map((c) => c.word));
    await vars.b.set(args.denops, "ddu_ui_std_items", args.items);
    await args.denops.cmd(
      "nnoremap <buffer><silent> <CR> <Cmd>call ddu#ui#std#do_action('open')<CR>",
    );
  }

  params(): {} {
    return {};
  }
}
