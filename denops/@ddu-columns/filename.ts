import { BaseColumn, DduItem, ItemHighlight } from "../ddu/types.ts";
import { GetTextResult } from "../ddu/base/column.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.14/deps.ts";

type Params = {
  collapsedIcon: string;
  expandedIcon: string;
  iconWidth: number;
  highlights: HighlightGroup;
};

type HighlightGroup = {
  directoryIcon?: string;
  directoryName?: string;
};

type ActionData = {
  isDirectory?: boolean;
  path?: string;
};

export class Column extends BaseColumn<Params> {
  async getLength(args: {
    denops: Denops;
    columnParams: Params;
    items: DduItem[];
  }): Promise<number> {
    const widths = await Promise.all(args.items.map(
      async (item) =>
        item.__level + 1 +
        (await fn.strwidth(
          args.denops,
          args.columnParams.iconWidth + (item.display ?? item.word),
        ) as number),
    )) as number[];
    return Math.max(...widths);
  }

  async getText(args: {
    denops: Denops;
    columnParams: Params;
    startCol: number;
    endCol: number;
    item: DduItem;
  }): Promise<GetTextResult> {
    const isDirectory = (args.item.action as ActionData).isDirectory;
    const highlights: ItemHighlight[] = [];
    const display = args.item.display ?? args.item.word;

    if (isDirectory) {
      const userHighlights = args.columnParams.highlights;
      highlights.push({
        name: "column-filename-directory-icon",
        "hl_group": userHighlights.directoryIcon ?? "Special",
        col: args.startCol + args.item.__level,
        width: args.columnParams.iconWidth,
      });

      highlights.push({
        name: "column-filename-directory-name",
        "hl_group": userHighlights.directoryName ?? "Directory",
        col: args.startCol + args.item.__level +
          args.columnParams.iconWidth + 1,
        width: display.length,
      });
    }

    const text = " ".repeat(args.item.__level) +
      (!isDirectory
        ? " "
        : args.item.__expanded
        ? args.columnParams.expandedIcon
        : args.columnParams.collapsedIcon) +
      " " + display;
    const width = await fn.strwidth(args.denops, text) as number;
    const padding = " ".repeat(args.endCol - args.startCol - width);

    return Promise.resolve({
      text: text + padding,
      highlights: highlights,
    });
  }

  params(): Params {
    return {
      collapsedIcon: "+",
      expandedIcon: "-",
      iconWidth: 1,
      highlights: {},
    };
  }
}
