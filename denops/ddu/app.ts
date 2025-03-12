import type {
  Action,
  ActionHistory,
  BaseParams,
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
  ContextBuilderImpl,
  defaultDduOptions,
  foldMerge,
  mergeDduOptions,
} from "./context.ts";
import { Loader } from "./loader.ts";
import {
  getFilter,
  getItemAction,
  getItemActions,
  uiSearchItem,
} from "./ext.ts";
import { isDenoCacheIssueError } from "./utils.ts";
import { type BaseUi, defaultUiOptions } from "./base/ui.ts";
import { type BaseSource, defaultSourceOptions } from "./base/source.ts";
import { type BaseFilter, defaultFilterOptions } from "./base/filter.ts";
import { type BaseKind, defaultKindOptions } from "./base/kind.ts";
import { type BaseColumn, defaultColumnOptions } from "./base/column.ts";
import { defaultActionOptions } from "./base/action.ts";

import type { Denops, Entrypoint } from "jsr:@denops/std@~7.5.0";

import { toFileUrl } from "jsr:@std/path@~1.0.2/to-file-url";
import { Lock } from "jsr:@core/asyncutil@~1.2.0/lock";
import { is } from "jsr:@core/unknownutil@~4.3.0/is";
import { ensure } from "jsr:@core/unknownutil@~4.3.0/ensure";

export const main: Entrypoint = (denops: Denops) => {
  type RedrawTreeMode = "collapse" | "expand";
  type RedrawOption = {
    check?: boolean;
    input?: string;
    method?: "refreshItems" | "uiRedraw" | "uiRefresh";
    searchItem?: DduItem;
  };

  const loaders: Record<string, Loader> = {};
  const ddus: Record<string, Ddu[]> = {};
  const contextBuilder = new ContextBuilderImpl();
  const clipboard: Clipboard = {
    action: "none",
    items: [],
    mode: "",
  };
  const actionHistory: ActionHistory = {
    actions: [],
  };
  const lock = new Lock(0);
  const uiRedrawLock = new Lock(0);

  const checkDdu = (name: string) => {
    if (!ddus[name]) {
      ddus[name] = [];
    }

    return ddus[name].length !== 0;
  };
  const getLoader = (name: string) => {
    if (!loaders[name]) {
      loaders[name] = new Loader();
    }

    return loaders[name];
  };
  const getDdu = (name: string) => {
    if (!checkDdu(name)) {
      ddus[name].push(new Ddu(getLoader(name), uiRedrawLock));
    }

    return ddus[name].slice(-1)[0];
  };
  const pushDdu = (name: string) => {
    checkDdu(name);

    ddus[name].push(new Ddu(getLoader(name), uiRedrawLock));

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
  const setAlias = (
    name: string,
    type: DduAliasType,
    alias: string,
    base: string,
  ) => {
    const loader = getLoader(name);
    loader.registerAlias(type, alias, base);
  };

  denops.dispatcher = {
    alias(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<void> {
      setAlias(
        ensure(arg1, is.String) as string,
        ensure(arg2, is.String) as DduAliasType,
        ensure(arg3, is.String) as string,
        ensure(arg4, is.String) as string,
      );
      return Promise.resolve();
    },
    async registerPath(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      const loader = getLoader(ensure(arg1, is.String) as string);
      await loader.registerPath(
        ensure(arg2, is.String) as DduExtType,
        ensure(arg3, is.String) as string,
      );
      return Promise.resolve();
    },
    registerExtension(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
      arg4: unknown,
    ): Promise<void> {
      const name = ensure(arg1, is.String);
      const type = ensure(arg2, is.String);
      const extName = ensure(arg3, is.String);

      const loader = getLoader(name);
      switch (type) {
        case "ui":
          loader.registerExtension(type, extName, arg4 as BaseUi<BaseParams>);
          break;
        case "source":
          loader.registerExtension(
            type,
            extName,
            arg4 as BaseSource<BaseParams>,
          );
          break;
        case "filter":
          loader.registerExtension(
            type,
            extName,
            arg4 as BaseFilter<BaseParams>,
          );
          break;
        case "kind":
          loader.registerExtension(type, extName, arg4 as BaseKind<BaseParams>);
          break;
        case "column":
          loader.registerExtension(
            type,
            extName,
            arg4 as BaseColumn<BaseParams>,
          );
          break;
      }

      return Promise.resolve();
    },
    setGlobal(arg1: unknown): Promise<void> {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      lock.lock(() => {
        contextBuilder.setGlobal(options);
      });
      return Promise.resolve();
    },
    setLocal(arg1: unknown, arg2: unknown): Promise<void> {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      const name = ensure(arg2, is.String) as string;
      lock.lock(() => {
        contextBuilder.setLocal(name, options);
      });
      return Promise.resolve();
    },
    patchGlobal(arg1: unknown): Promise<void> {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      lock.lock(() => {
        contextBuilder.patchGlobal(options);
      });
      return Promise.resolve();
    },
    patchLocal(arg1: unknown, arg2: unknown): Promise<void> {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      const name = ensure(arg2, is.String) as string;
      lock.lock(() => {
        contextBuilder.patchLocal(name, options);
      });
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
    async getCurrent(arg1: unknown): Promise<Partial<DduOptions>> {
      const name = ensure(arg1, is.String) as string;
      const ddu = getDdu(name);
      return Promise.resolve(await ddu.getCurrentOptions(denops));
    },
    getContext(arg1: unknown): Promise<Context> {
      const name = ensure(arg1, is.String) as string;
      const ddu = getDdu(name);
      return Promise.resolve(ddu.getContext());
    },
    getNames(): Promise<string[]> {
      const names = new Set(
        Object.keys(contextBuilder.getLocal()).concat(Object.keys(ddus)),
      );
      return Promise.resolve(Array.from(names));
    },
    getSourceNames(arg1: unknown): Promise<string[]> {
      const loader = getLoader(arg1 as string);
      return Promise.resolve(loader.getSourceNames());
    },
    getAliasNames(arg1: unknown, arg2: unknown): Promise<string[]> {
      const loader = getLoader(arg1 as string);
      return Promise.resolve(loader.getAliasNames(arg2 as DduAliasType));
    },
    async loadConfig(arg1: unknown): Promise<void> {
      //const startTime = Date.now();
      await lock.lock(async () => {
        const path = ensure(arg1, is.String) as string;

        try {
          // NOTE: Import module with fragment so that reload works properly.
          // https://github.com/vim-denops/denops.vim/issues/227
          const mod = await import(
            `${toFileUrl(path).href}#${performance.now()}`
          );
          const obj = new mod.Config();
          await obj.config({ denops, contextBuilder, setAlias });
        } catch (e) {
          if (isDenoCacheIssueError(e)) {
            console.warn("*".repeat(80));
            console.warn(`Deno module cache issue is detected.`);
            console.warn(
              `Execute '!deno cache --reload "${path}"' and restart Vim/Neovim.`,
            );
            console.warn("*".repeat(80));
          }

          console.error(`Failed to load file '${path}': ${e}`);
          throw e;
        }
      });
      //console.log(`${Date.now() - startTime} ms`);
      return Promise.resolve();
    },
    async loadExtensions(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      //const startTime = Date.now();
      const name = ensure(arg1, is.String) as string;
      const type = ensure(arg2, is.String) as DduExtType;
      const extNames = ensure(arg3, is.ArrayOf(is.String)) as string[];

      const loader = getLoader(name);
      for (const name of extNames) {
        await loader.autoload(denops, type, name);
      }
      //console.log(`${type} ${names}: ${Date.now() - startTime} ms`);
      return Promise.resolve();
    },
    async start(arg1: unknown): Promise<void> {
      //const startTime = Date.now();
      function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      // Waiting for lock to be released...
      while (lock.locked) {
        await sleep(100);
      }

      let userOptions = ensure(arg1, is.Record) as UserOptions;
      let [context, options] = await contextBuilder.get(denops, userOptions);

      let ddu: Ddu;

      // NOTE: Check if previous ddu exists
      if (options.push && checkDdu(options.name)) {
        const prevDdu = getDdu(options.name);

        // Cancel previous state
        await prevDdu.cancelToRefresh();

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

        // NOTE: Ensure winId is carried over to the pushed context.
        context.winId = prevDdu.getContext().winId;
      } else {
        ddu = getDdu(options.name);
      }

      await ddu.start(denops, context, options, userOptions);
      //console.log(`${Date.now() - startTime} ms`);
    },
    async getItems(arg1: unknown): Promise<DduItem[]> {
      let items: DduItem[] = [];

      await lock.lock(async () => {
        const userOptions = ensure(arg1, is.Record) as UserOptions;
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
      const name = ensure(arg1, is.String) as string;
      const opt = ensure(arg2, is.Record) as RedrawOption;
      //denops.cmd(`let &titlestring = "${opt?.input}"`);

      const ddu = getDdu(name);
      const loader = getLoader(name);
      let signal = ddu.cancelled;

      if (opt?.check && !(await ddu.checkUpdated(denops))) {
        // Mtime check failed
        return;
      }

      if (opt?.input !== undefined) {
        await ddu.setInput(denops, opt.input);
      }

      if (opt?.method === "refreshItems") {
        signal = await ddu.refresh(denops, [], { restoreTree: true });
      } else {
        // Check volatile sources
        const volatiles = ddu.getSourceArgs().map(
          (sourceArgs, index) => sourceArgs[0].volatile ? index : -1,
        ).filter((index) => index >= 0);

        if (volatiles.length > 0) {
          signal = await ddu.refresh(denops, volatiles, { restoreTree: true });
        } else if (opt?.method === "uiRedraw") {
          await ddu.restoreTree(denops, { preventRedraw: true, signal });
          await ddu.uiRedraw(denops, { signal });
        } else {
          await ddu.redraw(denops, { restoreTree: true, signal });
        }
      }

      if (opt?.searchItem && !signal.aborted) {
        await uiSearchItem(
          denops,
          loader,
          ddu.getContext(),
          ddu.getOptions(),
          opt.searchItem,
        );
      }

      denops.cmd("redraw");
    },
    async redrawTree(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<void> {
      const name = ensure(arg1, is.String) as string;
      const mode = ensure(arg2, is.String) as RedrawTreeMode;
      const items = ensure(arg3, is.Array) as ExpandItem[];

      const ddu = getDdu(name);

      if (mode === "collapse") {
        await ddu.collapseItems(denops, items.map((item) => item.item));
      } else if (mode === "expand") {
        await ddu.expandItems(denops, items);
      }
    },
    async updateOptions(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensure(arg1, is.String) as string;
      const updateOptions = ensure(arg2, is.Record) as UserOptions;

      // Abort the previous execution
      // Because the previous state may be freezed.
      const ddu = getDdu(name);
      await ddu.cancelToRefresh();

      if (updateOptions.ui && updateOptions.ui !== ddu.getOptions().ui) {
        // UI is changed
        await ddu.restart(denops, updateOptions);
      } else {
        ddu.updateOptions(updateOptions);
      }

      // NOTE: Reset aborter, because if it is not reseted, UI redraw is
      // failed.
      ddu.resetAborter();
    },
    async event(arg1: unknown, arg2: unknown): Promise<void> {
      const name = ensure(arg1, is.String) as string;
      const event = ensure(arg2, is.String) as DduEvent;

      const ddu = getDdu(name);

      if (event === "close" || event === "cancel") {
        ddu.quit();
      }

      await ddu.onEvent(denops, event);
    },
    async pop(arg1: unknown, arg2: unknown = {}): Promise<void> {
      const name = ensure(arg1, is.String) as string;
      const opt = ensure(arg2, is.Record) as {
        quit?: boolean;
        sync?: boolean;
      };

      if (!checkDdu(name)) {
        return;
      }
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
      const name = ensure(arg1, is.String) as string;
      const actionName = ensure(arg2, is.String) as string;
      const params = ensure(arg3, is.Record) as BaseParams;

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
      const name = ensure(arg1, is.String) as string;
      const actionName = ensure(arg2, is.String) as string;
      const items = ensure(arg3, is.Array) as DduItem[];
      const params = ensure(arg4, is.Record) as BaseParams;

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
    async getItemAction(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ): Promise<string | Action<BaseParams> | undefined> {
      const name = ensure(arg1, is.String) as string;
      const items = ensure(arg2, is.Array) as DduItem[];
      const action = ensure(arg3, is.String) as string;

      const ddu = getDdu(name);
      const loader = getLoader(name);
      const itemsAction = await getItemAction(
        denops,
        loader,
        ddu.getOptions(),
        action,
        items,
        {},
      );
      return itemsAction ? itemsAction.action : undefined;
    },
    async getItemActionNames(
      arg1: unknown,
      arg2: unknown,
    ): Promise<string[]> {
      const name = ensure(arg1, is.String) as string;
      const items = ensure(arg2, is.Array) as DduItem[];

      const ddu = getDdu(name);
      const loader = getLoader(name);
      const ret = await getItemActions(denops, loader, ddu.getOptions(), items);
      const actions = ret && ret.actions ? Object.keys(ret.actions) : [];
      const useActions = ddu.getOptions().actions;
      for (const aliasAction of loader.getAliasNames("action")) {
        const alias = loader.getAlias("action", aliasAction);
        if (
          alias && actions.indexOf(alias) >= 0 &&
          (useActions.length === 0 || useActions.includes(aliasAction))
        ) {
          actions.push(aliasAction);
        }
      }
      return actions.sort();
    },
    async getFilter(arg1: unknown, arg2: unknown): Promise<
      [
        string,
        FilterOptions,
        BaseParams,
      ]
    > {
      const name = ensure(arg1, is.String) as string;
      const filterName = ensure(arg2, is.String) as string;
      const ddu = getDdu(name);
      const loader = getLoader(name);
      const [filter, filterOptions, filterParams] = await getFilter(
        denops,
        loader,
        ddu.getOptions(),
        filterName,
      );
      return [filter?.path ?? "", filterOptions, filterParams];
    },
    async uiVisible(
      arg1: unknown,
      arg2: unknown,
    ): Promise<boolean> {
      const name = ensure(arg1, is.String) as string;
      const tabNr = ensure(arg2, is.Number) as number;

      const ddu = getDdu(name);
      return await ddu.uiVisible(denops, tabNr);
    },
    async uiWinids(
      arg1: unknown,
    ): Promise<number[]> {
      const name = ensure(arg1, is.String) as string;

      const ddu = getDdu(name);
      return await ddu.uiWinids(denops);
    },
    async uiUpdateCursor(
      arg1: unknown,
    ): Promise<void> {
      const name = ensure(arg1, is.String) as string;

      const ddu = getDdu(name);
      await ddu.uiUpdateCursor(denops);
    },
  };
};
