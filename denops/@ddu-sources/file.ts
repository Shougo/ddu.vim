import { BaseSource, Item } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { join, resolve } from "https://deno.land/std@0.119.0/path/mod.ts";

type ActionData = {
  path: string;
};

export class Source extends BaseSource<{}> {
  kind = "file";

  async gather(args: {
    denops: Denops;
  }): Promise<Item<ActionData>[]> {
    const tree = async (root: string) => {
      const items: Item<ActionData>[] = [];
      for await (const entry of Deno.readDir(root)) {
        items.push({
          word: join(root, entry.name),
          action: {
            path: join(root, entry.name),
          },
        });
      }

      return items;
    };

    const dir = ".";
    return tree(resolve(await fn.getcwd(args.denops) as string, String(dir)));
  }

  params(): {} {
    return {};
  }
}
