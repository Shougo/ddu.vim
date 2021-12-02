import { batch, Denops, ensureObject, vars } from "./deps.ts";

type RegisterArg = {
  path: string;
  name: string;
  type: "source" | "filter";
};

export async function main(denops: Denops) {
  denops.dispatcher = {
    async register(arg1: unknown): Promise<void> {
      const arg = arg1 as RegisterArg;
    },
    alias(arg1: unknown, arg2: unknown, arg3: unknown): Promise<void> {
      return Promise.resolve();
    },
    setGlobal(arg1: unknown): Promise<void> {
      ensureObject(arg1);
      const options = arg1 as Record<string, unknown>;
      return Promise.resolve();
    },
    setBuffer(arg1: unknown, arg2: unknown): Promise<void> {
      ensureObject(arg1);
      const options = arg1 as Record<string, unknown>;
      const name = arg2 as string;
      return Promise.resolve();
    },
    patchGlobal(arg1: unknown): Promise<void> {
      ensureObject(arg1);
      const options = arg1 as Record<string, unknown>;
      return Promise.resolve();
    },
    patchBuffer(arg1: unknown, arg2: unknown): Promise<void> {
      ensureObject(arg1);
      const options = arg1 as Record<string, unknown>;
      const name = arg2 as string;
      return Promise.resolve();
    },
    getGlobal(): Promise<void> {
      return Promise.resolve();
    },
    getBuffer(): Promise<void> {
      return Promise.resolve();
    },
  };

  await batch(denops, async (denops: Denops) => {
    console.log("Hello!");
    await vars.g.set(denops, "ddu#_initialized", 1);
  });
}
