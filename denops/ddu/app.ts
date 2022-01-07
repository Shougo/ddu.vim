import {
  batch,
  Denops,
  ensureArray,
  ensureObject,
  ensureString,
  vars,
} from "./deps.ts";
import { DduItem, DduOptions } from "./types.ts";
import { Ddu } from "./ddu.ts";
import { ContextBuilder } from "./context.ts";

type RegisterArg = {
  path: string;
  name: string;
  type: "source" | "filter";
};

export async function main(denops: Denops) {
  const ddu: Ddu = new Ddu();
  const contextBuilder = new ContextBuilder();

  denops.dispatcher = {
    setGlobal(arg1: unknown): Promise<void> {
      ensureObject(arg1);

      const options = arg1 as Record<string, unknown>;
      contextBuilder.setGlobal(options);
      return Promise.resolve();
    },
    setLocal(arg1: unknown, arg2: unknown): Promise<void> {
      ensureObject(arg1);

      const options = arg1 as Record<string, unknown>;
      const name = arg2 as string;
      contextBuilder.setLocal(name, options);
      return Promise.resolve();
    },
    patchGlobal(arg1: unknown): Promise<void> {
      ensureObject(arg1);

      const options = arg1 as Record<string, unknown>;
      contextBuilder.patchGlobal(options);
      return Promise.resolve();
    },
    patchLocal(arg1: unknown, arg2: unknown): Promise<void> {
      ensureObject(arg1);

      const options = arg1 as Record<string, unknown>;
      const name = arg2 as string;
      contextBuilder.patchLocal(name, options);
      return Promise.resolve();
    },
    getGlobal(): Promise<Partial<DduOptions>> {
      return Promise.resolve(contextBuilder.getGlobal());
    },
    getLocal(): Promise<Partial<DduOptions>> {
      return Promise.resolve(contextBuilder.getLocal());
    },
    async start(arg1: unknown): Promise<void> {
      ensureObject(arg1);

      const userOptions = arg1 as Record<string, unknown>;
      const options = contextBuilder.get(userOptions);
      await ddu.start(denops, options);
    },
    async narrow(arg1: unknown): Promise<void> {
      ensureString(arg1);

      const input = arg1 as string;
      await ddu.narrow(denops, input);
    },
    async doAction(arg1: unknown, arg2: unknown, arg3: unknown): Promise<void> {
      ensureString(arg1);
      ensureArray(arg2);
      ensureObject(arg3);

      const actionName = arg1 as string;
      const items = arg2 as DduItem[];
      const options = arg3;

      await ddu.doAction(denops, actionName, items, options);
    },
  };

  await batch(denops, async (denops: Denops) => {
    await vars.g.set(denops, "ddu#_initialized", 1);
  });
}
