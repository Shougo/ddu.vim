import { BaseSource, Item } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { join, resolve } from "https://deno.land/std@0.119.0/path/mod.ts";

export class Source extends BaseSource<{}> {
  async gather(args: {
    denops: Denops;
  }): Promise<Item<{}>[]> {
    const tree = async (root: string) => {
      const items: Item<{}>[] = [];
      for await (const entry of Deno.readDir(root)) {
        items.push({ word: join(root, entry.name) });
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
