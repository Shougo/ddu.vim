import { BaseColumn, DduItem, ItemHighlight } from "../ddu/types.ts";
import { GetTextResult } from "../ddu/base/column.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v0.14/deps.ts";

type Params = {
  collapsedIcon: string;
  expandedIcon: string;
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
  getLength(_: {
    denops: Denops;
    items: DduItem[];
  }): Promise<number> {
    return Promise.resolve(100);
  }

  getText(args: {
    denops: Denops;
    columnParams: Params;
    startCol: number;
    item: DduItem;
  }): Promise<GetTextResult> {
    const isDirectory = (args.item.action as ActionData).isDirectory;
    const highlights: ItemHighlight[] = [];
    const display = args.item.display ?? args.item.word;

    if (isDirectory) {
      const userHighlights = args.columnParams.highlights;
      const iconWidth = 1;
      highlights.push({
        name: "column-filename-directory-icon",
        "hl_group": userHighlights.directoryIcon ?? "Special",
        col: args.startCol + args.item.__level,
        width: iconWidth,
      })

      highlights.push({
        name: "column-filename-directory-name",
        "hl_group": userHighlights.directoryName ?? "Directory",
        col: args.startCol + args.item.__level + iconWidth + 1,
        width: display.length,
      })
    }

    const text = " ".repeat(args.item.__level) +
      (!isDirectory
        ? " "
        : args.item.__expanded
        ? args.columnParams.expandedIcon
        : args.columnParams.collapsedIcon) +
      " " + display;

    return Promise.resolve({
      text: text,
      highlights: highlights,
    });
  }

  params(): Params {
    return {
      collapsedIcon: "+",
      expandedIcon: "-",
      highlights: {},
    };
  }
}
