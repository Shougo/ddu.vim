import { batch, Denops, vars } from "./deps.ts";

export async function main(denops: Denops) {
  denops.dispatcher = {};

  await batch(denops, async (denops: Denops) => {
    await vars.g.set(denops, "ddu#_initialized", 1);
  });
}
