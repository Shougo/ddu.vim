import {
  batch,
  Denops,
  ensureArray,
  ensureNumber,
  ensureObject,
  ensureString,
  Lock,
  vars,
} from "./deps.ts";
import {
  BaseActionParams,
  BaseFilterParams,
  Clipboard,
  Context,
  DduEvent,
  DduExtType,
  DduItem,
  DduOptions,
  ExpandItem,
  FilterOptions,
  PreviewContext,
  Previewer,
  UserOptions,
} from "./types.ts";
import { Ddu } from "./ddu.ts";
import { ContextBuilder, defaultDduOptions } from "./context.ts";

export async function main(denops: Denops) {
  type RedrawTreeMode = "collapse" | "expand";
  type RedrawOption = {
    check?: boolean;
    input?: string;
    refreshItems?: boolean;
    updateOptions?: UserOptions;
  };

  const ddus: Record<string, Ddu[]> = {};
  const contextBuilder = new ContextBuilder();
  const aliases: Record<DduExtType | "action", Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
    action: {},
  };
  const clipboard: Clipboard = {
    action: "none",
    items: [],
    mode: "",
  };
  const lock = new Lock();
  let queuedName: string | null = null;
  let queuedRedrawOption: RedrawOption | null = null;

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
    getContext(arg1: unknown): Promise<Context> {
      const name = ensureString(arg1);
      const ddu = getDdu(name);
      return Promise.resolve(ddu.getContext());
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
      queuedName = ensureString(arg1);
      queuedRedrawOption = ensureObject(arg2) as RedrawOption;

      // Note: must be locked
      await lock.with(async () => {
        while (queuedName != null) {
          const name = queuedName;
          const opt = queuedRedrawOption;
          queuedName = null;
          queuedRedrawOption = null;

          const ddu = getDdu(name);

          if (opt?.check && !(await ddu.checkUpdated(denops))) {
            // Mtime check failed
            continue;
          }

          if (opt?.input != null) {
            ddu.setInput(opt.input);
          }

          if (opt?.updateOptions) {
            ddu.updateOptions(opt.updateOptions);
          }

          if (opt?.refreshItems || opt?.updateOptions) {
            await ddu.refresh(denops);
            continue;
          }

          // Check volatile sources
          const volatiles = [];
          let index = 0;
          for (const sourceArgs of ddu.getSourceArgs()) {
            if (sourceArgs[0].volatile) {
              volatiles.push(index);
            }
            index++;
          }

          if (volatiles.length > 0) {
            await ddu.refresh(denops, volatiles);
          } else {
            await ddu.redraw(denops);
          }
        }
      });
    },
    async redrawTree(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      const name = ensureString(arg1);
      const mode = ensureString(arg2) as RedrawTreeMode;
      const items = ensureArray(arg3) as ExpandItem[];

      const ddu = getDdu(name);

      if (mode == "collapse") {
        await ddu.collapseItems(denops, items.map((item) => item.item));
      } else if (mode == "expand") {
        ddu.expandItems(denops, items);
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
    async pop(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensureString(arg1);
      const opt = ensureObject(arg2) as {
        quit?: boolean;
        sync?: boolean;
      };

      const dduLength = ddus[name].length;
      const currentDdu = dduLength > 1 ? popDdu(name) : getDdu(name);
      if (!currentDdu) {
        return;
      }

      if (dduLength <= 1 || opt?.quit) {
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
      const ret = await ddu.getItemActions(denops, items);
      const actions = ret && ret.actions ? Object.keys(ret.actions) : [];
      for (const aliasAction of Object.keys(aliases.action)) {
        if (actions.indexOf(aliases.action[aliasAction]) >= 0) {
          actions.push(aliasAction);
        }
      }
      return actions;
    },
    async getPreviewer(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<Previewer | undefined> {
      const name = ensureString(arg1);
      const item = ensureObject(arg2) as DduItem;
      const actionParams = arg3 as BaseActionParams;
      const previewContext = ensureObject(arg4) as PreviewContext;
      const ddu = getDdu(name);
      return await ddu.getPreviewer(
        denops,
        item,
        actionParams,
        previewContext,
      );
    },
    async getFilter(arg1: unknown, arg2: unknown): Promise<
      [
        string,
        FilterOptions,
        BaseFilterParams,
      ]
    > {
      const name = ensureString(arg1);
      const filterName = ensureString(arg2);
      const ddu = getDdu(name);
      const [filter, filterOptions, filterParams] = await ddu.getFilter(
        denops,
        filterName,
      );
      return [filter ? filter.path : "", filterOptions, filterParams];
    },
    async uiVisible(
      arg1: unknown,
      arg2: unknown,
    ): Promise<boolean> {
      const name = ensureString(arg1);
      const tabNr = ensureNumber(arg2);

      const ddu = getDdu(name);
      return await ddu.uiVisible(denops, tabNr);
    },
    async uiWinid(
      arg1: unknown,
    ): Promise<number> {
      const name = ensureString(arg1);

      const ddu = getDdu(name);
      return await ddu.uiWinid(denops);
    },
  };

  await batch(denops, async (denops: Denops) => {
    await vars.g.set(denops, "ddu#_initialized", 1);
    await denops.cmd("doautocmd <nomodeline> User DDUReady");
    await denops.cmd("autocmd! User DDUReady");
  });
}
