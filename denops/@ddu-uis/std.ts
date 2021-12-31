import { BaseUi, DduItem } from "../ddu/types.ts";
import { Denops, fn, vars } from "../ddu/deps.ts";

type Params = Record<never, never>;

export class Ui extends BaseUi<Params> {
  async redraw(args: {
    denops: Denops;
    items: DduItem[];
  }): Promise<void> {
    // Initialize buffer
    const bufnr = await fn.bufadd(args.denops, "ddu-std-bufferName");
    await fn.bufload(args.denops, bufnr);
    await fn.setbufvar(args.denops, bufnr, "&modifiable", 1);
    await fn.setbufline(args.denops, bufnr, 1, args.items.map((c) => c.word));
    await fn.setbufvar(args.denops, bufnr, "&modifiable", 0);
    await fn.setbufvar(args.denops, bufnr, "&modified", 0);

    await args.denops.cmd(`buffer ${bufnr}`);
    await vars.b.set(args.denops, "ddu_ui_std_items", args.items);
    await args.denops.cmd(
      "nnoremap <buffer><silent> <CR> <Cmd>call ddu#ui#std#do_action('default')<CR>",
    );
  }

  params(): Params {
    return {};
  }
}
