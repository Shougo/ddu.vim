import { assertEquals, Denops, fn, is, Lock } from "./deps.ts";
import {
  Action,
  ActionName,
  ActionOptions,
  BaseActionParams,
  BaseColumn,
  BaseColumnParams,
  BaseFilter,
  BaseFilterParams,
  BaseKind,
  BaseKindParams,
  BaseSource,
  BaseSourceParams,
  BaseUi,
  BaseUiParams,
  ColumnOptions,
  Context,
  DduItem,
  DduOptions,
  FilterOptions,
  Item,
  ItemAction,
  KindOptions,
  PreviewContext,
  Previewer,
  SourceOptions,
  UiOptions,
  UserColumn,
  UserFilter,
  UserSource,
} from "./types.ts";
import {
  defaultDduOptions,
  defaultDummy,
  foldMerge,
  mergeActionOptions,
  mergeActionParams,
  mergeColumnOptions,
  mergeColumnParams,
  mergeFilterOptions,
  mergeFilterParams,
  mergeKindOptions,
  mergeKindParams,
  mergeSourceOptions,
  mergeSourceParams,
  mergeUiOptions,
  mergeUiParams,
} from "./context.ts";
import { defaultUiOptions } from "./base/ui.ts";
import { defaultSourceOptions, GatherArguments } from "./base/source.ts";
import { defaultFilterOptions } from "./base/filter.ts";
import { defaultColumnOptions } from "./base/column.ts";
import { defaultKindOptions } from "./base/kind.ts";
import { defaultActionOptions } from "./base/action.ts";
import { Loader } from "./loader.ts";
import { convertUserString, printError } from "./utils.ts";

type ItemActions = {
  source: BaseSource<BaseSourceParams, unknown>;
  kind: BaseKind<BaseKindParams>;
  actions: Record<string, unknown>;
};

type ItemActionInfo = {
  userSource: UserSource;
  sourceIndex: number;
  sourceOptions: SourceOptions;
  sourceParams: BaseSourceParams;
  kindOptions: KindOptions;
  kindParams: BaseKindParams;
  actionOptions: ActionOptions;
  actionParams: BaseActionParams;
  action: string | Action<BaseActionParams>;
};

export async function getItemActions(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  items: DduItem[],
): Promise<ItemActions | null> {
  const sources = [
    ...new Set(
      items.length > 0
        ? items.map((item) => loader.getSource(options.name, item.__sourceName))
        : options.sources.map((userSource) =>
          loader.getSource(
            options.name,
            convertUserString(userSource).name,
          )
        ),
    ),
  ].filter((source) => source);
  const indexes = [
    ...new Set(items.map((item) => item.__sourceIndex)),
  ];
  if (sources.length === 0 || sources.length !== 1 && indexes.length !== 1) {
    if (sources.length > 0) {
      await printError(
        denops,
        `You must not mix multiple sources items: "${
          sources.map((source) => source?.name)
        }"`,
      );
    }
    return null;
  }
  const source = sources[0];
  if (!source) {
    return null;
  }

  const kinds = [
    ...new Set(
      items.length > 0
        ? items.map((item) => item.kind)
        : sources.map((source) => source?.kind),
    ),
  ] as string[];
  if (kinds.length !== 1) {
    await printError(denops, `You must not mix multiple kinds: "${kinds}"`);
    return null;
  }

  const kindName = kinds[0];
  const kind = await getKind(denops, loader, options, kindName);
  if (!kind) {
    return null;
  }

  const [kindOptions, _1] = kindArgs(kind, options);
  const [sourceOptions, _2] = sourceArgs(
    source,
    options,
    options.sources[indexes.length > 0 ? indexes[0] : 0],
  );

  const actions = Object.assign(
    kind.actions,
    kindOptions.actions,
    source.actions,
    sourceOptions.actions,
  );

  // Filter by options.actions
  const filteredActions = options.actions.length === 0
    ? actions
    : Object.keys(actions).reduce(
      (acc: Record<ActionName, ItemAction>, key) => {
        if (options.actions.includes(key)) {
          acc[key] = actions[key];
        }
        return acc;
      },
      {},
    );

  return {
    source,
    kind,
    actions: filteredActions,
  };
}

export async function getItemAction(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  actionName: string,
  items: DduItem[],
  userActionParams: BaseActionParams,
): Promise<ItemActionInfo | undefined> {
  if (items.length === 0) {
    return;
  }

  const itemActions = await getItemActions(denops, loader, options, items);
  if (!itemActions) {
    return;
  }

  const { source, kind, actions } = itemActions;

  const indexes = [
    ...new Set(items.map((item) => item.__sourceIndex)),
  ];

  const sourceIndex = indexes.length > 0 ? indexes[0] : 0;
  const userSource = options.sources[sourceIndex];
  const [sourceOptions, sourceParams] = sourceArgs(
    source,
    options,
    userSource,
  );

  const [kindOptions, kindParams] = kindArgs(kind, options);

  // Get default action in the first
  if (actionName === "default") {
    actionName = sourceOptions.defaultAction;
    if (actionName === "") {
      // Use kind default action
      actionName = kindOptions.defaultAction;
    }

    if (actionName === "") {
      await printError(
        denops,
        `The default action is not defined for the items`,
      );
      return;
    }
  }

  // NOTE: "actionName" may be overwritten by aliases
  const [actionOptions, actionParams] = actionArgs(
    actionName,
    options,
    userActionParams,
  );

  // Check action aliases
  actionName = loader.getAlias("action", actionName) ?? actionName;

  const action = actions[actionName] as
    | string
    | Action<BaseActionParams>;
  if (!action) {
    await printError(denops, `Not found action: ${actionName}`);
    return;
  }

  return {
    userSource,
    sourceIndex,
    sourceOptions,
    sourceParams,
    kindOptions,
    kindParams,
    actionOptions,
    actionParams,
    action,
  };
}

export async function callOnRefreshItemsHooks(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  sourceOptions: SourceOptions,
): Promise<void> {
  const filters = [
    ...sourceOptions.matchers,
    ...sourceOptions.sorters,
    ...sourceOptions.converters,
  ];
  await Promise.all(filters.map(async (userFilter) => {
    const [filter, filterOptions, filterParams] = await getFilter(
      denops,
      loader,
      options,
      userFilter,
    );
    await filter?.onRefreshItems?.({
      denops,
      filterOptions,
      filterParams,
    });
  }));
}

export async function uiSearchItem(
  denops: Denops,
  loader: Loader,
  context: Context,
  options: DduOptions,
  searchItem: DduItem,
): Promise<void> {
  const [ui, uiOptions, uiParams] = await getUi(
    denops,
    loader,
    options,
  );
  if (!ui) {
    return;
  }

  console.log(searchItem);
  await ui.searchItem({
    denops,
    context,
    options,
    uiOptions,
    uiParams,
    item: searchItem,
  });
}

export async function getUi(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
): Promise<
  [
    BaseUi<BaseUiParams> | undefined,
    UiOptions,
    BaseUiParams,
  ]
> {
  const userUi = convertUserString(options.ui);
  if (!loader.getUi(options.name, userUi.name)) {
    const startTime = Date.now();

    await loader.autoload(denops, "ui", userUi.name);

    if (options.profile) {
      await printError(
        denops,
        `Load ${userUi.name}: ${Date.now() - startTime} ms`,
      );
    }
  }

  const ui = loader.getUi(options.name, userUi.name);
  if (!ui) {
    if (userUi.name.length !== 0) {
      await printError(denops, `Not found ui: "${userUi.name}"`);
    }
    return [
      undefined,
      defaultUiOptions(),
      defaultDummy(),
    ];
  }

  const [uiOptions, uiParams] = uiArgs(options, ui);
  await checkUiOnInit(ui, denops, uiOptions, uiParams);

  return [ui, uiOptions, uiParams];
}

export async function getSource(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  name: string,
  userSource: UserSource,
): Promise<
  [
    BaseSource<BaseSourceParams> | undefined,
    SourceOptions,
    BaseSourceParams,
  ]
> {
  if (!loader.getSource(options.name, name)) {
    const startTime = Date.now();

    await loader.autoload(denops, "source", name);

    if (options.profile) {
      await printError(denops, `Load ${name}: ${Date.now() - startTime} ms`);
    }
  }

  const source = loader.getSource(options.name, name);
  if (!source) {
    await printError(denops, `Not found source: ${name}`);
    return [
      undefined,
      defaultSourceOptions(),
      defaultDummy(),
    ];
  }

  const [sourceOptions, sourceParams] = sourceArgs(
    source,
    options,
    userSource,
  );

  return [source, sourceOptions, sourceParams];
}

export async function getFilter(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  userFilter: UserFilter,
): Promise<
  [
    BaseFilter<BaseFilterParams> | undefined,
    FilterOptions,
    BaseFilterParams,
  ]
> {
  userFilter = convertUserString(userFilter);

  if (!loader.getFilter(options.name, userFilter.name)) {
    const startTime = Date.now();

    await loader.autoload(denops, "filter", userFilter.name);

    if (options.profile) {
      await printError(
        denops,
        `Load ${userFilter.name}: ${Date.now() - startTime} ms`,
      );
    }
  }

  const filter = loader.getFilter(options.name, userFilter.name);
  if (!filter) {
    await printError(denops, `Not found filter: ${userFilter.name}`);
    return [
      undefined,
      defaultFilterOptions(),
      defaultDummy(),
    ];
  }

  const [filterOptions, filterParams] = filterArgs(
    filter,
    options,
    userFilter,
  );
  await checkFilterOnInit(filter, denops, filterOptions, filterParams);

  return [filter, filterOptions, filterParams];
}

async function getKind(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  name: string,
): Promise<
  BaseKind<BaseKindParams> | undefined
> {
  if (!loader.getKind(options.name, name)) {
    const startTime = Date.now();

    await loader.autoload(denops, "kind", name);

    if (options.profile) {
      await printError(denops, `Load ${name}: ${Date.now() - startTime} ms`);
    }
  }

  const kind = loader.getKind(options.name, name);
  if (!kind) {
    if (name !== "base") {
      await printError(denops, `Not found kind: ${name}`);
    }
    return undefined;
  }

  return kind;
}

export async function getColumn(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  userColumn: UserColumn,
): Promise<
  [
    BaseColumn<BaseColumnParams> | undefined,
    ColumnOptions,
    BaseColumnParams,
  ]
> {
  userColumn = convertUserString(userColumn);

  if (!loader.getColumn(options.name, userColumn.name)) {
    const startTime = Date.now();

    await loader.autoload(denops, "column", userColumn.name);

    if (options.profile) {
      await printError(
        denops,
        `Load ${userColumn.name}: ${Date.now() - startTime} ms`,
      );
    }
  }

  const column = loader.getColumn(options.name, userColumn.name);
  if (!column) {
    await printError(denops, `Not found column: ${userColumn.name}`);
    return [
      undefined,
      defaultColumnOptions(),
      defaultDummy(),
    ];
  }

  const [columnOptions, columnParams] = columnArgs(
    column,
    options,
    userColumn,
  );
  await checkColumnOnInit(column, denops, columnOptions, columnParams);

  return [column, columnOptions, columnParams];
}

export async function callFilters(
  denops: Denops,
  loader: Loader,
  context: Context,
  options: DduOptions,
  sourceOptions: SourceOptions,
  filters: UserFilter[],
  input: string,
  items: DduItem[],
) {
  for (const userFilter of filters) {
    const [filter, filterOptions, filterParams] = await getFilter(
      denops,
      loader,
      options,
      userFilter,
    );
    if (!filter || input.length < filterOptions.minInputLength) {
      continue;
    }

    try {
      const ret = await filter.filter({
        denops,
        context: context,
        options: options,
        sourceOptions,
        filterOptions,
        filterParams,
        input,
        items,
      });

      if (is.Array(ret)) {
        items = ret;
      } else {
        if (ret.input) {
          // Overwrite current input
          input = ret.input;
        }
        items = ret.items;
      }
    } catch (e: unknown) {
      await printError(denops, `filter: ${filter.name} "filter()" failed`, e);
    }
  }

  return items;
}

export async function callColumns(
  denops: Denops,
  loader: Loader,
  context: Context,
  options: DduOptions,
  columns: UserColumn[],
  items: DduItem[],
  allItems: DduItem[],
) {
  if (columns.length === 0) {
    return items;
  }

  type CachedColumn = {
    column: BaseColumn<BaseColumnParams>;
    columnOptions: ColumnOptions;
    columnParams: BaseColumnParams;
    length: number;
  };
  const userColumns = columns.map((column) => convertUserString(column));
  const cachedColumns: Record<number, CachedColumn> = {};
  for (const [index, userColumn] of userColumns.entries()) {
    const [column, columnOptions, columnParams] = await getColumn(
      denops,
      loader,
      options,
      userColumn,
    );
    if (!column) {
      continue;
    }

    const length = await column.getLength({
      denops,
      context,
      options,
      columnOptions,
      columnParams,
      items: allItems,
    });

    cachedColumns[index] = {
      column,
      columnOptions,
      columnParams,
      length,
    };
  }

  for (const item of items) {
    item.display = "";
    item.highlights = [];
  }

  for (const item of items) {
    let startCol = 1;
    for (const index of userColumns.keys()) {
      const cachedColumn = cachedColumns[index];
      if (!cachedColumn) {
        continue;
      }

      if (!item.__columnTexts[index] && cachedColumn.column.getBaseText) {
        item.__columnTexts[index] = await cachedColumn.column.getBaseText({
          denops,
          context,
          options,
          columnOptions: cachedColumn.columnOptions,
          columnParams: cachedColumn.columnParams,
          item,
        });
      }

      const text = await cachedColumn.column.getText({
        denops,
        context,
        options,
        columnOptions: cachedColumn.columnOptions,
        columnParams: cachedColumn.columnParams,
        startCol,
        endCol: startCol + cachedColumn.length,
        item,
        baseText: item.__columnTexts[index],
      });

      if (text.highlights && item.highlights) {
        item.highlights = item.highlights.concat(text.highlights);
      }

      item.display += text.text;

      if (columns.length === 1) {
        // Optimize
        continue;
      }

      startCol += cachedColumn.length;

      // Check text width.
      const width = await fn.strdisplaywidth(denops, text.text);
      const len = (new TextEncoder()).encode(text.text).length;
      if (width < len) {
        // NOTE: Padding is needed.  Because Vim/neovim highlight is length.
        startCol += len - width;
        item.display += " ".repeat(len - width);
      }
    }
  }
}

export async function getPreviewer(
  denops: Denops,
  loader: Loader,
  options: DduOptions,
  item: DduItem,
  actionParams: BaseActionParams,
  previewContext: PreviewContext,
): Promise<Previewer | undefined> {
  const source = loader.getSource(
    options.name,
    item.__sourceName,
  );
  if (!source) {
    return;
  }
  const kindName = item.kind ?? source.kind;

  const kind = await getKind(denops, loader, options, kindName);
  if (!kind || !kind.getPreviewer) {
    return;
  }

  return kind.getPreviewer({
    denops,
    options,
    actionParams,
    previewContext,
    item,
  });
}

function uiArgs<
  Params extends BaseUiParams,
>(
  options: DduOptions,
  ui: BaseUi<Params>,
): [UiOptions, BaseUiParams] {
  const o = foldMerge(
    mergeUiOptions,
    defaultUiOptions,
    [
      options.uiOptions["_"],
      options.uiOptions[ui.name],
    ],
  );
  const p = foldMerge(mergeUiParams, defaultDummy, [
    ui.params(),
    options.uiParams["_"],
    options.uiParams[ui.name],
  ]);
  return [o, p];
}

export function sourceArgs<
  Params extends BaseSourceParams,
  UserData extends unknown,
>(
  source: BaseSource<Params, UserData> | null,
  options: DduOptions,
  userSource: UserSource | null,
): [SourceOptions, BaseSourceParams] {
  userSource = convertUserString(userSource);

  const o = foldMerge(
    mergeSourceOptions,
    defaultSourceOptions,
    [
      options.sourceOptions["_"],
      source ? options.sourceOptions[source.name] : {},
      userSource?.options,
    ],
  );
  const p = foldMerge(
    mergeSourceParams,
    defaultDummy,
    [
      source?.params(),
      options.sourceParams["_"],
      source ? options.sourceParams[source.name] : {},
      userSource?.params,
    ],
  );
  return [o, p];
}

function filterArgs<
  Params extends BaseFilterParams,
>(
  filter: BaseFilter<Params>,
  options: DduOptions,
  userFilter: UserFilter,
): [FilterOptions, BaseFilterParams] {
  userFilter = convertUserString(userFilter);

  const o = foldMerge(
    mergeFilterOptions,
    defaultFilterOptions,
    [
      options.filterOptions["_"],
      options.filterOptions[filter.name],
      userFilter?.options,
    ],
  );
  const p = foldMerge(
    mergeFilterParams,
    defaultDummy,
    [
      filter?.params(),
      options.filterParams["_"],
      options.filterParams[filter.name],
      userFilter?.params,
    ],
  );
  return [o, p];
}

function kindArgs<
  Params extends BaseKindParams,
>(
  kind: BaseKind<Params>,
  options: DduOptions,
): [KindOptions, BaseKindParams] {
  const o = foldMerge(
    mergeKindOptions,
    defaultKindOptions,
    [
      options.kindOptions["_"],
      options.kindOptions[kind.name],
    ],
  );
  const p = foldMerge(
    mergeKindParams,
    defaultDummy,
    [
      kind?.params(),
      options.kindParams["_"],
      options.kindParams[kind.name],
    ],
  );
  return [o, p];
}

function columnArgs<
  Params extends BaseColumnParams,
>(
  column: BaseColumn<Params>,
  options: DduOptions,
  userColumn: UserColumn,
): [ColumnOptions, BaseColumnParams] {
  userColumn = convertUserString(userColumn);

  const o = foldMerge(
    mergeColumnOptions,
    defaultColumnOptions,
    [
      options.columnOptions["_"],
      options.columnOptions[column.name],
      userColumn?.options,
    ],
  );
  const p = foldMerge(
    mergeColumnParams,
    defaultDummy,
    [
      column?.params(),
      options.columnParams["_"],
      options.columnParams[column.name],
      userColumn?.params,
    ],
  );
  return [o, p];
}

function actionArgs(
  actionName: string,
  options: DduOptions,
  params: BaseActionParams,
): [ActionOptions, BaseActionParams] {
  const o = foldMerge(
    mergeActionOptions,
    defaultActionOptions,
    [
      options.actionOptions["_"],
      options.actionOptions[actionName],
    ],
  );
  const p = foldMerge(mergeActionParams, defaultDummy, [
    options.actionParams["_"],
    options.actionParams[actionName],
    params,
  ]);
  return [o, p];
}

export async function initSource<
  Params extends BaseSourceParams,
  UserData extends unknown,
>(
  denops: Denops,
  source: BaseSource<Params, UserData>,
  sourceOptions: SourceOptions,
  sourceParams: Params,
  loader: Loader,
): Promise<void> {
  source.isInitialized = false;
  await source.onInit({
    denops,
    sourceOptions,
    sourceParams,
    loader,
  });
  source.isInitialized = true;
}

async function checkUiOnInit(
  ui: BaseUi<BaseUiParams>,
  denops: Denops,
  uiOptions: UiOptions,
  uiParams: BaseUiParams,
) {
  if (ui.isInitialized) {
    return;
  }

  try {
    await ui.onInit({
      denops,
      uiOptions,
      uiParams,
    });

    ui.isInitialized = true;
  } catch (e: unknown) {
    await printError(denops, `ui: ${ui.name} "onInit()" failed`, e);
  }
}

export async function uiRedraw<
  Params extends BaseUiParams,
>(
  denops: Denops,
  lock: Lock<number>,
  context: Context,
  options: DduOptions,
  ui: BaseUi<Params>,
  uiOptions: UiOptions,
  uiParams: Params,
  signal: AbortSignal,
): Promise<void> {
  // NOTE: Redraw must be locked
  await lock.lock(async () => {
    if (await fn.getcmdwintype(denops) !== "") {
      // Skip when Command line window
      return;
    }

    try {
      if (signal.aborted) {
        await ui.quit({
          denops,
          context,
          options,
          uiOptions,
          uiParams,
        });
        return;
      }

      const prevWinids = await ui.winIds({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      await ui.redraw({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      // NOTE: ddu may be quitted after redraw
      if (signal.aborted) {
        await ui.quit({
          denops,
          context,
          options,
          uiOptions,
          uiParams,
        });
      }

      await denops.cmd("doautocmd <nomodeline> User Ddu:redraw");

      const winIds = await ui.winIds({
        denops,
        context,
        options,
        uiOptions,
        uiParams,
      });

      if (winIds.length > prevWinids.length) {
        // NOTE: UI window is generated.
        await denops.cmd("doautocmd <nomodeline> User Ddu:uiReady");
      }

      if (!ui.prevDone && context.done) {
        await denops.cmd("doautocmd <nomodeline> User Ddu:uiDone");
      }

      ui.prevDone = context.done;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes(" E523: ")) {
        // NOTE: It may be called on invalid state
        // Ignore "E523: Not allowed here" errors
        await denops.call("ddu#_lazy_redraw", options.name);
      } else {
        await printError(denops, `ui: ${ui.name} "redraw()" failed`, e);
      }
    }
  });
}

async function checkFilterOnInit(
  filter: BaseFilter<BaseFilterParams>,
  denops: Denops,
  filterOptions: FilterOptions,
  filterParams: BaseFilterParams,
) {
  if (filter.isInitialized) {
    return;
  }

  try {
    await filter.onInit({
      denops,
      filterOptions,
      filterParams,
    });

    filter.isInitialized = true;
  } catch (e: unknown) {
    await printError(denops, `filter: ${filter.name} "onInit()" failed`, e);
  }
}

async function checkColumnOnInit(
  column: BaseColumn<BaseColumnParams>,
  denops: Denops,
  columnOptions: ColumnOptions,
  columnParams: BaseColumnParams,
) {
  if (column.isInitialized) {
    return;
  }

  try {
    await column.onInit({
      denops,
      columnOptions,
      columnParams,
    });

    column.isInitialized = true;
  } catch (e: unknown) {
    await printError(denops, `column: ${column.name} "onInit()" failed`, e);
  }
}

Deno.test("sourceArgs", () => {
  const userOptions: DduOptions = {
    ...defaultDduOptions(),
    sources: [],
    sourceOptions: {
      "_": {
        matcherKey: "foo",
        matchers: ["matcher_head"],
      },
      "strength": {
        matcherKey: "bar",
      },
    },
    sourceParams: {
      "_": {
        "by_": "bar",
      },
      "strength": {
        min: 100,
      },
    },
  };
  class S extends BaseSource<{ min: number; max: number }> {
    params() {
      return {
        "min": 0,
        "max": 999,
      };
    }
    gather(
      _args: GatherArguments<{ min: number; max: number }> | Denops,
    ): ReadableStream<Item<Record<string, never>>[]> {
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    }
  }
  const source = new S();
  source.name = "strength";
  const [o, p] = sourceArgs(source, userOptions, null);
  assertEquals(o, {
    ...defaultSourceOptions(),
    matcherKey: "bar",
    matchers: ["matcher_head"],
    converters: [],
    sorters: [],
  });
  assertEquals(p, {
    ...defaultDummy(),
    by_: "bar",
    min: 100,
    max: 999,
  });
});
