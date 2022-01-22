import { BaseSource, Item } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { join, resolve } from "https://deno.land/std@0.120.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.1.0/file.ts#^";

type Params = {
  path: string;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    return new ReadableStream({
      async start(controller) {
        const maxItems = 20000;

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

            if (items.length > maxItems) {
              // Update items
              controller.enqueue(items);

              // Clear
              items = [];
            }
          }

          return items;
        };

        let dir = args.sourceParams.path;
        if (dir == "") {
          dir = await fn.getcwd(args.denops) as string;
        }

        controller.enqueue(
          await tree(resolve(dir, dir)),
        );

        controller.close();
      },
    });
  }

  params(): Params {
    return {
      path: "",
    };
  }
}
