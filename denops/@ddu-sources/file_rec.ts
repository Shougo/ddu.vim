import { BaseSource, Item } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { join, resolve } from "https://deno.land/std@0.119.0/path/mod.ts";

type ActionData = {
  path: string;
};

type Params = Record<never, never>;

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
  }): ReadableStream<Item<ActionData>[]> {
    const tree = async (root: string) => {
      let items: Item<ActionData>[] = [];
      for await (const entry of Deno.readDir(root)) {
        const path = join(root, entry.name);
        items.push({
          word: path,
          action: {
            path: path,
          },
        });

        if (entry.isDirectory && entry.name !== ".git") {
          items = items.concat(await tree(path));
        }
      }

      return items;
    };

    return new ReadableStream({
      async start(controller) {
        const dir = await fn.getcwd(args.denops) as string;

        controller.enqueue(
          await tree(resolve(dir, dir)),
        );
        controller.close();
      },
    });
  }

  params(): Params {
    return {};
  }
}
