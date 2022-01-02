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

    return new ReadableStream({
      async start(controller) {
        const dir = ".";

        controller.enqueue(
          await tree(
            resolve(await fn.getcwd(args.denops) as string, String(dir)),
          ),
        );
        controller.close();
      },
    });
  }

  params(): Params {
    return {};
  }
}
