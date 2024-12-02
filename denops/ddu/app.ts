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
  ContextBuilder,
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
import { BaseUi, defaultUiOptions } from "./base/ui.ts";
import { BaseSource, defaultSourceOptions } from "./base/source.ts";
import { BaseFilter, defaultFilterOptions } from "./base/filter.ts";
import { BaseKind, defaultKindOptions } from "./base/kind.ts";
import { BaseColumn, defaultColumnOptions } from "./base/column.ts";
import { defaultActionOptions } from "./base/action.ts";

import type { Denops, Entrypoint } from "jsr:@denops/std@~7.4.0";

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
    alias(arg1: unknown, arg2: unknown, arg3: unknown) {
      setAlias(
        ensure(arg1, is.String) as DduAliasType,
        ensure(arg2, is.String) as string,
        ensure(arg3, is.String) as string,
      );
    },
    async registerPath(arg1: unknown, arg2: unknown) {
      await loader.registerPath(
        ensure(arg1, is.String) as DduExtType,
        ensure(arg2, is.String) as string,
      );
    },
    registerExtension(
      arg1: unknown,
      arg2: unknown,
      arg3: unknown,
    ) {
      const type = ensure(arg1, is.String);
      const name = ensure(arg2, is.String);
      if (type === "ui") {
        loader.registerExtension(type, name, arg3 as BaseUi<BaseParams>);
      } else if (type === "source") {
        loader.registerExtension(type, name, arg3 as BaseSource<BaseParams>);
      } else if (type === "filter") {
        loader.registerExtension(type, name, arg3 as BaseFilter<BaseParams>);
      } else if (type === "kind") {
        loader.registerExtension(type, name, arg3 as BaseKind<BaseParams>);
      } else if (type === "column") {
        loader.registerExtension(type, name, arg3 as BaseColumn<BaseParams>);
      }
    },
    setGlobal(arg1: unknown) {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      contextBuilder.setGlobal(options);
    },
    setLocal(arg1: unknown, arg2: unknown) {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      const name = ensure(arg2, is.String) as string;
      contextBuilder.setLocal(name, options);
    },
    patchGlobal(arg1: unknown) {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      contextBuilder.patchGlobal(options);
    },
    patchLocal(arg1: unknown, arg2: unknown) {
      const options = ensure(arg1, is.Record) as Partial<DduOptions>;
      const name = ensure(arg2, is.String) as string;
      contextBuilder.patchLocal(name, options);
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
    getSourceNames(): Promise<string[]> {
      return Promise.resolve(loader.getSourceNames());
    },
    getAliasNames(arg1: unknown): Promise<string[]> {
      return Promise.resolve(loader.getAliasNames(arg1 as DduAliasType));
    },
    async loadConfig(arg1: unknown): Promise<void> {
      //const startTime = Date.now();
      // NOTE: Lock until load finished to prevent execute start() API.
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
      //console.log(`${arg1}: ${Date.now() - startTime} ms`);
      return Promise.resolve();
    },
    async loadExtensions(arg1: unknown, arg2: unknown): Promise<void> {
      //const startTime = Date.now();
      const type = ensure(arg1, is.String) as DduExtType;
      const names = ensure(arg2, is.ArrayOf(is.String)) as string[];
      for (const name of names) {
        await loader.autoload(denops, type, name);
      }
      //console.log(`${type} ${names}: ${Date.now() - startTime} ms`);
      return Promise.resolve();
    },
    async setStaticImportPath(): Promise<void> {
      await loader.initStaticImportPath(denops);
      return Promise.resolve();
    },
    async start(arg1: unknown): Promise<void> {
      //const startTime = Date.now();
      await lock.lock(async () => {
        let userOptions = ensure(arg1, is.Record) as UserOptions;
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
      queuedName = ensure(arg1, is.String) as string;
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

          // Check volatile sources
          const volatiles = ddu.getSourceArgs().map(
            (sourceArgs, index) => sourceArgs[0].volatile ? index : -1,
          ).filter((index) => index >= 0);

          if (volatiles.length > 0 || opt?.method === "refreshItems") {
            await ddu.refresh(
              denops,
              opt?.method === "refreshItems" ? [] : volatiles,
            );
          } else if (opt?.method === "uiRedraw") {
            await ddu.uiRedraw(denops);
          } else {
            await ddu.redraw(denops);
          }
          await ddu.restoreTree(denops);

          if (opt?.searchItem) {
            await uiSearchItem(
              denops,
              loader,
              ddu.getContext(),
              ddu.getOptions(),
              opt.searchItem,
            );
          }
        }
      });
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
