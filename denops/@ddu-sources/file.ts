import { BaseSource, Candidate } from "../ddu/types.ts";
import { Denops, fn } from "../ddu/deps.ts";
import { join, resolve } from "https://deno.land/std@0.119.0/path/mod.ts";

export class Source extends BaseSource<{}> {
  async gather(args: {
    denops: Denops;
  }): Promise<Candidate<{}>[]> {
    const tree = async (root: string) => {
      const candidates: Candidate<{}>[] = [];
      for await (const entry of Deno.readDir(root)) {
        candidates.push({ word: join(root, entry.name) });
      }

      return candidates;
    };

    const dir = ".";
    return tree(resolve(await fn.getcwd(args.denops) as string, String(dir)));
  }

  params(): {} {
    return {};
  }
}
