import { BaseColumn, DduItem } from "../ddu/types.ts";
import { GetTextResult } from "../ddu/base/column.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v0.14/deps.ts";

type Params = {
  collapsedIcon: string;
  expandedIcon: string;
};

type ActionData = {
  isDirectory?: boolean;
  path?: string;
};

export class Column extends BaseColumn<Params> {
  getLength(_: {
    denops: Denops;
    items: DduItem[];
  }): Promise<number> {
    return Promise.resolve(100);
  }

  getText(args: {
    denops: Denops;
    columnParams: Params;
    item: DduItem;
  }): Promise<GetTextResult> {
    const text = " ".repeat(args.item.__level) +
      (!(args.item.action as ActionData).isDirectory
        ? " "
        : args.item.__expanded
        ? args.columnParams.expandedIcon
        : args.columnParams.collapsedIcon) +
      " " + (args.item.display ?? args.item.word);
    return Promise.resolve({
      text: text,
      highlights: [],
    });
  }

  params(): Params {
    return {
      collapsedIcon: "+",
      expandedIcon: "-",
    };
  }
}
