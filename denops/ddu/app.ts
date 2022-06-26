import {
  batch,
  Denops,
  ensureArray,
  ensureObject,
  ensureString,
  vars,
} from "./deps.ts";
import {
  Clipboard,
  DduEvent,
  DduExtType,
  DduItem,
  DduOptions,
  PreviewContext,
  Previewer,
} from "./types.ts";
import { Ddu } from "./ddu.ts";
import { ContextBuilder, defaultDduOptions } from "./context.ts";

type RedrawTreeMode = "collapse" | "expand";

export async function main(denops: Denops) {
  const ddus: Record<string, Ddu[]> = {};
  const contextBuilder = new ContextBuilder();
  const aliases: Record<DduExtType, Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
  };
  const clipboard: Clipboard = {
    action: "none",
    items: [],
    mode: "",
  };

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

    if (ddus[name].length == 0) {
      return null;
    }

    // Save the last
    const lastDdu = ddus[name].slice(-1)[0];

    ddus[name].pop();

    return lastDdu;
  };

  denops.dispatcher = {
    setGlobal(arg1: unknown): Promise<void> {
      const options = ensureObject(arg1);
      contextBuilder.setGlobal(options);
      return Promise.resolve();
    },
    setLocal(arg1: unknown, arg2: unknown): Promise<void> {
      const options = ensureObject(arg1);
      const name = ensureString(arg2);
      contextBuilder.setLocal(name, options);
      return Promise.resolve();
    },
    patchGlobal(arg1: unknown): Promise<void> {
      const options = ensureObject(arg1);
      contextBuilder.patchGlobal(options);
      return Promise.resolve();
    },
    patchLocal(arg1: unknown, arg2: unknown): Promise<void> {
      const options = ensureObject(arg1);
      const name = ensureString(arg2);
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
    getCurrent(arg1: unknown): Promise<Partial<DduOptions>> {
      const name = ensureString(arg1);
      const ddu = getDdu(name);
      return Promise.resolve(ddu.getOptions());
    },
    alias(arg1: unknown, arg2: unknown, arg3: unknown): Promise<void> {
      const extType = ensureString(arg1) as DduExtType;
      const alias = ensureString(arg2);
      const base = ensureString(arg3);

      aliases[extType][alias] = base;
      return Promise.resolve();
    },
    async start(arg1: unknown): Promise<void> {
      let userOptions = ensureObject(arg1);
      const [context, options] = await contextBuilder.get(denops, userOptions);

      let ddu = getDdu(options.name);

      if (options.push) {
        const prevDdu = ddu;
        ddu = pushDdu(options.name);
        // Extends previous options
        userOptions = Object.assign(prevDdu.getUserOptions(), userOptions);
      }

      await ddu.start(denops, aliases, context, options, userOptions);
    },
    async redraw(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensureString(arg1);
      const opt = ensureObject(arg2) as {
        check?: boolean;
        input?: string;
        refreshItems?: boolean;
        updateOptions?: Record<string, unknown>;
      };

      const ddu = getDdu(name);

      if (opt?.check && !(await ddu.checkUpdated(denops))) {
        // Mtime check failed
        return;
      }

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
    async redrawTree(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<void> {
      const name = ensureString(arg1);
      const mode = ensureString(arg2) as RedrawTreeMode;
      const item = ensureObject(arg3) as DduItem;
      const opt = ensureObject(arg4) as {
        maxLevel?: number;
        search?: string;
      };

      const ddu = getDdu(name);

      if (mode == "collapse") {
        await ddu.collapseItem(denops, item);
      } else if (mode == "expand") {
        const maxLevel = opt.maxLevel && opt.maxLevel < 0
          ? -1
          : item.__level + (opt.maxLevel ?? 0);
        await ddu.expandItem(denops, item, maxLevel, opt.search);
      }
    },
    async event(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensureString(arg1);
      const event = ensureString(arg2) as DduEvent;

      const ddu = getDdu(name);

      if (event == "close" || event == "cancel") {
        ddu.quit();
      }

      await ddu.onEvent(denops, event);
    },
    async pop(arg1: unknown): Promise<void> {
      const name = ensureString(arg1);

      const dduLength = ddus[name].length;
      const currentDdu = dduLength > 1 ? popDdu(name) : getDdu(name);
      if (!currentDdu) {
        return;
      }

      if (dduLength <= 1) {
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
      await ddu.start(denops, aliases, context, options, userOptions);
    },
    async uiAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      const name = ensureString(arg1);
      const actionName = ensureString(arg2);
      const params = ensureObject(arg3);

      const ddu = getDdu(name);
      await ddu.uiAction(denops, actionName, params);
    },
    async itemAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<void> {
      const name = ensureString(arg1);
      const actionName = ensureString(arg2);
      const items = ensureArray(arg3) as DduItem[];
      const params = ensureObject(arg4);

      const ddu = getDdu(name);
      await ddu.itemAction(denops, actionName, items, params, clipboard);
    },
    async getItemActions(
      arg1: unknown,
      arg2: unknown,
    ): Promise<string[]> {
      const name = ensureString(arg1);
      const items = ensureArray(arg2) as DduItem[];

      const ddu = getDdu(name);
      const actions = await ddu.getItemActions(denops, items);
      return actions ? Object.keys(actions) : [];
    },
    async getPreviewer(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<Previewer | undefined> {
      const name = ensureString(arg1);
      const items = ensureObject(arg2) as DduItem;
      const actionParams = arg3;
      const previewContext = ensureObject(arg4) as PreviewContext;
      const ddu = getDdu(name);
      return await ddu.getPreviewer(
        denops,
        items,
        actionParams,
        previewContext,
      );
    },
  };

  await batch(denops, async (denops: Denops) => {
    await vars.g.set(denops, "ddu#_initialized", 1);
    await denops.cmd("doautocmd <nomodeline> User DDUReady");
    await denops.cmd("autocmd! User DDUReady");
  });
}
