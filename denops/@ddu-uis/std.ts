import { BaseUi, DduItem, DduOptions, UiOptions } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";

type Params = Record<never, never>;

export class Ui extends BaseUi<Params> {
  async redraw(args: {
    denops: Denops;
    options: DduOptions;
    uiOptions: UiOptions;
    items: DduItem[];
  }): Promise<void> {
    const bufferName = `ddu-std-${args.options.name}`;
    let bufnr;
    if (await fn.bufexists(args.denops, bufferName)) {
      bufnr = await fn.bufnr(args.denops, bufferName);
    } else {
      // Initialize buffer
      bufnr = await fn.bufadd(args.denops, bufferName);
      await fn.bufload(args.denops, bufnr);
    }

    await fn.setbufvar(args.denops, bufnr, "&filetype", "ddu-std");

    await fn.setbufvar(args.denops, bufnr, "&modifiable", 1);

    // Note: Use only 1000 items
    const items = args.items.slice(0, 1000);

    const ids = await fn.win_findbuf(args.denops, bufnr) as number[];
    if (ids.length == 0) {
      await args.denops.cmd(`buffer ${bufnr}`);
    }

    // Update main buffer
    await args.denops.call(
      "ddu#ui#std#update_buffer",
      bufnr,
      items.map((c) => c.word),
    );

    await fn.setbufvar(args.denops, bufnr, "ddu_ui_std_items", items);
    await fn.setbufvar(args.denops, bufnr, "ddu_ui_name", args.options.name);

    // Open filter window
    await args.denops.call(
      "ddu#ui#std#filter#_open",
      args.options.name,
      args.options.input,
    );
  }

  params(): Params {
    return {};
  }
}
