import { BaseUi, DduItem, DduOptions, UiOptions } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { ActionArguments } from "../ddu/base/ui.ts";

type DoActionParams = {
  name?: string;
  params?: unknown;
};

type Params = Record<never, never>;

export class Ui extends BaseUi<Params> {
  private items: DduItem[] = [];

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

    this.items = items;
    await fn.setbufvar(args.denops, bufnr, "ddu_ui_name", args.options.name);

    // Open filter window
    await args.denops.call(
      "ddu#ui#std#filter#_open",
      args.options.name,
      args.options.input,
    );
  }

  actions: Record<string, (args: ActionArguments<Params>) => Promise<void>> = {
    doAction: async (args: {
      denops: Denops;
      options: DduOptions;
      actionParams: unknown;
    }) => {
      const idx = (await fn.line(args.denops, ".")) - 1;
      const item = this.items[idx];
      const params = args.actionParams as DoActionParams;
      await args.denops.call(
        "ddu#do_action",
        args.options.name,
        params.name ?? "default",
        [item],
        params.params ?? {},
      );
    },
  };

  params(): Params {
    return {};
  }
}
