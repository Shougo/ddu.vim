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
  const ddus: Record<string, Ddu> = {};
  const contextBuilder = new ContextBuilder();

  const getDdu = (name: string) => {
    if (!(name in ddus)) {
      ddus[name] = new Ddu();
    }
    return ddus[name];
  };

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

      const ddu = getDdu(options.name);
      await ddu.start(denops, options);
    },
    async narrow(arg1: unknown, arg2: unknown): Promise<void> {
      ensureString(arg1);
      ensureString(arg2);

      const name = arg1 as string;
      const input = arg2 as string;

      const ddu = getDdu(name);
      await ddu.narrow(denops, input);
    },
    async doAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<void> {
      ensureString(arg1);
      ensureString(arg2);
      ensureArray(arg3);
      ensureObject(arg4);

      const name = arg1 as string;
      const actionName = arg2 as string;
      const items = arg3 as DduItem[];
      const options = arg4;

      const ddu = getDdu(name);
      await ddu.doAction(denops, actionName, items, options);
    },
  };

  await batch(denops, async (denops: Denops) => {
    await vars.g.set(denops, "ddu#_initialized", 1);
  });
}
