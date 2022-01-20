import { BaseSource, Context, Item } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { ActionData } from "../@ddu-kinds/file.ts";

type Params = Record<never, never>;

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    context: Context;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    return new ReadableStream({
      async start(controller) {
        const bufnr = args.context.bufNr;
        const lines = await fn.getline(args.denops, 1, "$");
        controller.enqueue(lines.map((line, i) => {
          return {
            word: line,
            action: {
              bufNr: bufnr,
              lineNr: i + 1,
            },
          };
        }));

        controller.close();
      },
    });
  }

  params(): Params {
    return {};
  }
}
