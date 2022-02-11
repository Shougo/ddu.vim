import {
  batch,
  Denops,
  ensureArray,
  ensureObject,
  ensureString,
  vars,
} from "./deps.ts";
import { DduEvent, DduItem, DduOptions } from "./types.ts";
import { Ddu } from "./ddu.ts";
import { ContextBuilder, defaultDduOptions } from "./context.ts";

export async function main(denops: Denops) {
  const ddus: Record<string, Ddu[]> = {};
  const contextBuilder = new ContextBuilder();

  const getDdu = (name: string) => {
    if (!ddus[name]) {
      ddus[name] = [];
    }
    if (ddus[name].length == 0) {
      ddus[name].push(new Ddu());
    }
    return ddus[name].slice(-1)[0];
  };
  const pushDdu = (name: string) => {
    if (!ddus[name]) {
      ddus[name] = [];
    }
    ddus[name].push(new Ddu());
    return ddus[name].slice(-1)[0];
  };
  const popDdu = (name: string) => {
    if (!ddus[name]) {
      ddus[name] = [];
    }

    return ddus[name].length == 0 ? null : ddus[name].pop();
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
    getDefaultOptions(): Promise<Partial<DduOptions>> {
      return Promise.resolve(defaultDduOptions());
    },
    async start(arg1: unknown): Promise<void> {
      ensureObject(arg1);

      const userOptions = arg1 as Record<string, unknown>;
      const [context, options] = await contextBuilder.get(denops, userOptions);

      const ddu = options.push ? pushDdu(options.name) : getDdu(options.name);
      await ddu.start(denops, context, options, userOptions);
    },
    async redraw(arg1: unknown, arg2: unknown): Promise<void> {
      ensureString(arg1);
      ensureObject(arg2);

      const name = arg1 as string;
      const opt = arg2 as {
        input?: string;
        refreshItems?: boolean;
        updateOptions?: Record<string, unknown>;
      };

      const ddu = getDdu(name);

      if (opt?.input != null) {
        ddu.setInput(opt.input);
      }

      if (opt?.updateOptions) {
        ddu.updateOptions(opt.updateOptions);
      }

      if (
        ddu.getOptions().volatile ||
        opt?.refreshItems || opt?.updateOptions
      ) {
        await ddu.refresh(denops);
      } else {
        await ddu.redraw(denops);
      }
    },
    async event(arg1: unknown, arg2: unknown): Promise<void> {
      ensureString(arg1);
      ensureString(arg2);

      const name = arg1 as string;
      const event = arg2 as DduEvent;

      const ddu = getDdu(name);

      if (event == "close" || event == "cancel") {
        ddu.quit();
      }

      await ddu.onEvent(denops, event);
    },
    async pop(arg1: unknown): Promise<void> {
      ensureString(arg1);

      const name = arg1 as string;

      const currentDdu = popDdu(name);
      if (!currentDdu) {
        return;
      }

      if (ddus[name].length == 0) {
        // Quit current ddu
        currentDdu.quit();
        await currentDdu.onEvent(denops, "cancel");
        return;
      }

      // Resume previous ddu state
      const userOptions = {
        refresh: true,
        resume: true,
      };
      const [context, options] = await contextBuilder.get(
        denops,
        userOptions,
      );
      const ddu = getDdu(name);
      await ddu.start(denops, context, options, userOptions);
    },
    async uiAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      ensureString(arg1);
      ensureString(arg2);
      ensureObject(arg3);

      const name = arg1 as string;
      const actionName = arg2 as string;
      const params = arg3;

      const ddu = getDdu(name);
      await ddu.uiAction(denops, actionName, params);
    },
    async itemAction(
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
      const params = arg4;

      const ddu = getDdu(name);
      await ddu.itemAction(denops, actionName, items, params);
    },
  };

  await batch(denops, async (denops: Denops) => {
    await vars.g.set(denops, "ddu#_initialized", 1);
    await denops.cmd("doautocmd <nomodeline> User DDUReady");
  });
}
