import { Denops, ensure, is, Lock, toFileUrl } from "./deps.ts";
import {
  ActionHistory,
  BaseFilterParams,
  Clipboard,
  Context,
  DduAliasType,
  DduEvent,
  DduExtType,
  DduItem,
  DduOptions,
  ExpandItem,
  FilterOptions,
  UserOptions,
} from "./types.ts";
import { Ddu } from "./ddu.ts";
import {
  ContextBuilder,
  defaultDduOptions,
  foldMerge,
  mergeDduOptions,
} from "./context.ts";
import { Loader } from "./loader.ts";
import { defaultUiOptions } from "./base/ui.ts";
import { defaultSourceOptions } from "./base/source.ts";
import { defaultFilterOptions } from "./base/filter.ts";
import { defaultColumnOptions } from "./base/column.ts";
import { defaultKindOptions } from "./base/kind.ts";
import { defaultActionOptions } from "./base/action.ts";

export function main(denops: Denops) {
  type RedrawTreeMode = "collapse" | "expand";
  type RedrawOption = {
    check?: boolean;
    input?: string;
    refreshItems?: boolean;
    updateOptions?: UserOptions;
  };

  const loader = new Loader();
  const ddus: Record<string, Ddu[]> = {};
  const contextBuilder = new ContextBuilder();
  const clipboard: Clipboard = {
    action: "none",
    items: [],
    mode: "",
  };
  const actionHistory: ActionHistory = {
    actions: [],
  };
  const lock = new Lock(0);
  let queuedName: string | null = null;
  let queuedRedrawOption: RedrawOption | null = null;

  const checkDdu = (name: string) => {
    if (!ddus[name]) {
      ddus[name] = [];
    }

    return ddus[name].length !== 0;
  };
  const getDdu = (name: string) => {
    if (!checkDdu(name)) {
      ddus[name].push(new Ddu(loader));
    }

    return ddus[name].slice(-1)[0];
  };
  const pushDdu = (name: string) => {
    checkDdu(name);

    ddus[name].push(new Ddu(loader));

    return ddus[name].slice(-1)[0];
  };
  const popDdu = (name: string) => {
    if (!checkDdu(name)) {
      return null;
    }

    // Save the last
    const lastDdu = ddus[name].slice(-1)[0];

    ddus[name].pop();

    return lastDdu;
  };
  const setAlias = (type: DduAliasType, alias: string, base: string) => {
    loader.registerAlias(type, alias, base);
  };

  denops.dispatcher = {
    alias(arg1: unknown, arg2: unknown, arg3: unknown): Promise<void> {
      setAlias(
        ensure(arg1, is.String) as DduAliasType,
        ensure(arg2, is.String),
        ensure(arg3, is.String),
      );
      return Promise.resolve();
    },
    async register(arg1: unknown, arg2: unknown): Promise<void> {
      await loader.registerPath(
        ensure(arg1, is.String) as DduExtType,
        ensure(arg2, is.String),
      );
      return Promise.resolve();
    },
    setGlobal(arg1: unknown): Promise<void> {
      const options = ensure(arg1, is.Record);
      contextBuilder.setGlobal(options);
      return Promise.resolve();
    },
    setLocal(arg1: unknown, arg2: unknown): Promise<void> {
      const options = ensure(arg1, is.Record);
      const name = ensure(arg2, is.String);
      contextBuilder.setLocal(name, options);
      return Promise.resolve();
    },
    patchGlobal(arg1: unknown): Promise<void> {
      const options = ensure(arg1, is.Record);
      contextBuilder.patchGlobal(options);
      return Promise.resolve();
    },
    patchLocal(arg1: unknown, arg2: unknown): Promise<void> {
      const options = ensure(arg1, is.Record);
      const name = ensure(arg2, is.String);
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
      return Promise.resolve(Object.assign(defaultDduOptions(), {
        actionOptions: defaultActionOptions(),
        columnOptions: defaultColumnOptions(),
        filterOptions: defaultFilterOptions(),
        kindOptions: defaultKindOptions(),
        sourceOptions: defaultSourceOptions(),
        uiOptions: defaultUiOptions(),
      }));
    },
    getCurrent(arg1: unknown): Promise<Partial<DduOptions>> {
      const name = ensure(arg1, is.String);
      const ddu = getDdu(name);
      return Promise.resolve(ddu.getOptions());
    },
    getContext(arg1: unknown): Promise<Context> {
      const name = ensure(arg1, is.String);
      const ddu = getDdu(name);
      return Promise.resolve(ddu.getContext());
    },
    getSourceNames(): Promise<string[]> {
      return Promise.resolve(loader.getSourceNames());
    },
    getAliasNames(arg1: unknown): Promise<string[]> {
      return Promise.resolve(loader.getAliasNames(arg1 as DduAliasType));
    },
    async loadConfig(arg1: unknown): Promise<void> {
      // NOTE: Lock until load finished to prevent execute start() API.
      await lock.lock(async () => {
        const path = ensure(arg1, is.String);
        // NOTE: Import module with fragment so that reload works properly.
        // https://github.com/vim-denops/denops.vim/issues/227
        const mod = await import(
          `${toFileUrl(path).href}#${performance.now()}`
        );
        const obj = new mod.Config();
        await obj.config({ denops, contextBuilder, setAlias });
      });
      return Promise.resolve();
    },
    async loadExtensions(arg1: unknown, arg2: unknown): Promise<void> {
      const type = ensure(arg1, is.String) as DduExtType;
      const names = ensure(arg2, is.ArrayOf(is.String));
      for (const name of names) {
        await loader.autoload(denops, type, name);
      }
      return Promise.resolve();
    },
    async start(arg1: unknown): Promise<void> {
      await lock.lock(async () => {
        let userOptions = ensure(arg1, is.Record);
        let [context, options] = await contextBuilder.get(denops, userOptions);

        let ddu: Ddu;

        // NOTE: Check if previous ddu exists
        if (options.push && checkDdu(options.name)) {
          const prevDdu = getDdu(options.name);
          ddu = pushDdu(options.name);

          // Extends previous options
          const prevOptions = {
            ...prevDdu.getOptions(),
            input: "",
          };
          userOptions = foldMerge(mergeDduOptions, defaultDduOptions, [
            prevOptions,
            userOptions,
          ]);

          [context, options] = await contextBuilder.get(denops, userOptions);
        } else {
          ddu = getDdu(options.name);
        }

        await ddu.start(denops, context, options, userOptions);
      });
    },
    async getItems(arg1: unknown): Promise<DduItem[]> {
      let items: DduItem[] = [];

      await lock.lock(async () => {
        const userOptions = ensure(arg1, is.Record);
        userOptions.ui = "";
        userOptions.sync = true;

        const [context, options] = await contextBuilder.get(
          denops,
          userOptions,
        );

        const ddu = getDdu(options.name);

        await ddu.start(denops, context, options, userOptions);

        items = ddu.getItems();
      });

      return items;
    },
    async redraw(arg1: unknown, arg2: unknown): Promise<void> {
      queuedName = ensure(arg1, is.String);
      queuedRedrawOption = ensure(arg2, is.Record) as RedrawOption;

      // NOTE: must be locked
      await lock.lock(async () => {
        while (queuedName !== null) {
          const name = queuedName;
          const opt = queuedRedrawOption;
          queuedName = null;
          queuedRedrawOption = null;

          const ddu = getDdu(name);

          if (opt?.check && !(await ddu.checkUpdated(denops))) {
            // Mtime check failed
            continue;
          }

          if (opt?.input !== undefined) {
            await ddu.setInput(denops, opt.input);
          }

          if (opt?.updateOptions) {
            const updateOptions = opt.updateOptions;
            if (
              (updateOptions.ui && updateOptions.ui !== ddu.getOptions().ui) ||
              (updateOptions.uiOptions !== ddu.getOptions().uiOptions) ||
              (updateOptions.uiParams !== ddu.getOptions().uiParams)
            ) {
              // UI is changed
              await ddu.restart(denops, updateOptions);
              continue;
            }

            ddu.updateOptions(updateOptions);
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
      const name = ensure(arg1, is.String);
      const mode = ensure(arg2, is.String) as RedrawTreeMode;
      const items = ensure(arg3, is.Array) as ExpandItem[];

      const ddu = getDdu(name);

      if (mode === "collapse") {
        await ddu.collapseItems(denops, items.map((item) => item.item));
      } else if (mode === "expand") {
        ddu.expandItems(denops, items);
      }
    },
    async event(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensure(arg1, is.String);
      const event = ensure(arg2, is.String) as DduEvent;

      const ddu = getDdu(name);

      if (event === "close" || event === "cancel") {
        ddu.quit();
      }

      await ddu.onEvent(denops, event);
    },
    async pop(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensure(arg1, is.String);
      const opt = ensure(arg2, is.Record) as {
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
      const ddu = getDdu(name);
      const userOptions = foldMerge(mergeDduOptions, defaultDduOptions, [
        ddu.getOptions(),
        {
          refresh: true,
          resume: true,
        },
      ]);
      const [context, options] = await contextBuilder.get(
        denops,
        userOptions,
      );
      await ddu.start(denops, context, options, userOptions);
    },
    async uiAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      const name = ensure(arg1, is.String);
      const actionName = ensure(arg2, is.String);
      const params = ensure(arg3, is.Record);

      const ddu = getDdu(name);
      if (ddu.getOptions().ui !== "") {
        await ddu.uiAction(denops, actionName, params);
      }
    },
    async itemAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<void> {
      const name = ensure(arg1, is.String);
      const actionName = ensure(arg2, is.String);
      const items = ensure(arg3, is.Array) as DduItem[];
      const params = ensure(arg4, is.Record);

      const ddu = getDdu(name);
      await ddu.itemAction(
        denops,
        actionName,
        items,
        params,
        clipboard,
        actionHistory,
      );
    },
    async getItemActions(
      arg1: unknown,
      arg2: unknown,
    ): Promise<string[]> {
      const name = ensure(arg1, is.String);
      const items = ensure(arg2, is.Array) as DduItem[];

      const ddu = getDdu(name);
      const ret = await ddu.getItemActions(denops, items);
      const actions = ret && ret.actions ? Object.keys(ret.actions) : [];
      for (const aliasAction of loader.getAliasNames("action")) {
        const alias = loader.getAlias("action", aliasAction);
        if (alias && actions.indexOf(alias) >= 0) {
          actions.push(aliasAction);
        }
      }
      return actions;
    },
    async getFilter(arg1: unknown, arg2: unknown): Promise<
      [
        string,
        FilterOptions,
        BaseFilterParams,
      ]
    > {
      const name = ensure(arg1, is.String);
      const filterName = ensure(arg2, is.String);
      const ddu = getDdu(name);
      const [filter, filterOptions, filterParams] = await ddu.getFilter(
        denops,
        filterName,
      );
      return [filter?.path ?? "", filterOptions, filterParams];
    },
    async uiVisible(
      arg1: unknown,
      arg2: unknown,
    ): Promise<boolean> {
      const name = ensure(arg1, is.String);
      const tabNr = ensure(arg2, is.Number);

      const ddu = getDdu(name);
      return await ddu.uiVisible(denops, tabNr);
    },
    async uiWinid(
      arg1: unknown,
    ): Promise<number> {
      const name = ensure(arg1, is.String);

      const ddu = getDdu(name);
      return await ddu.uiWinid(denops);
    },
  };
}
