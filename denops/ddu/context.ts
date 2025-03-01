import type {
  ActionOptions,
  BaseParams,
  ColumnOptions,
  Context,
  ContextBuilder,
  DduOptions,
  FilterOptions,
  KindOptions,
  SourceOptions,
  UiOptions,
  UserOptions,
} from "./types.ts";
import { defaultSourceOptions } from "./base/source.ts";
import { printError } from "./utils.ts";

import type { Denops } from "jsr:@denops/std@~7.5.0";
import * as fn from "jsr:@denops/std@~7.5.0/function";

import { assertEquals } from "jsr:@std/assert@~1.0.2/equals";

// where
// T: Object
// partialMerge: PartialMerge
// partialMerge(partialMerge(a, b), c) === partialMerge(a, partialMerge(b, c))
type PartialMerge<T> = (a: Partial<T>, b: Partial<T>) => Partial<T>;
type Merge<T> = (a: T, b: Partial<T>) => T;
type Default<T> = () => T;

function partialOverwrite<T>(a: Partial<T>, b: Partial<T>): Partial<T> {
  return { ...a, ...b };
}

function overwrite<T>(a: T, b: Partial<T>): T {
  return { ...a, ...b };
}

export const mergeUiOptions: Merge<UiOptions> = overwrite;
export const mergeSourceOptions: Merge<SourceOptions> = overwrite;
export const mergeFilterOptions: Merge<FilterOptions> = overwrite;
export const mergeColumnOptions: Merge<ColumnOptions> = overwrite;
export const mergeKindOptions: Merge<KindOptions> = overwrite;
export const mergeActionOptions: Merge<ActionOptions> = overwrite;

export const mergeUiParams: Merge<BaseParams> = overwrite;
export const mergeSourceParams: Merge<BaseParams> = overwrite;
export const mergeFilterParams: Merge<BaseParams> = overwrite;
export const mergeColumnParams: Merge<BaseParams> = overwrite;
export const mergeKindParams: Merge<BaseParams> = overwrite;
export const mergeActionParams: Merge<BaseParams> = overwrite;

export function foldMerge<T>(
  merge: Merge<T>,
  def: Default<T>,
  partials: (null | undefined | Partial<T>)[],
): T {
  return partials.map((x) => x || {}).reduce(merge, def());
}

export function defaultContext(): Context {
  return {
    bufName: "",
    bufNr: 0,
    cwd: "",
    done: false,
    doneUi: false,
    input: "",
    maxItems: 0,
    mode: "",
    path: "",
    pathHistories: [],
    winId: 0,
  };
}

export function defaultDduOptions(): DduOptions {
  return {
    actionOptions: {},
    actionParams: {},
    actions: [],
    columnOptions: {},
    columnParams: {},
    expandInput: false,
    filterOptions: {},
    filterParams: {},
    kindOptions: {},
    kindParams: {},
    input: "",
    name: "default",
    postFilters: [],
    profile: false,
    push: false,
    refresh: false,
    resume: false,
    searchPath: "",
    sourceOptions: {},
    sourceParams: {},
    sources: [],
    sync: false,
    syncLimit: 0,
    syncTimeout: 0,
    ui: "",
    uiOptions: {},
    uiParams: {},
    unique: false,
  };
}

export function defaultDummy(): Record<string, unknown> {
  return {};
}

function migrateEachKeys<T>(
  merge: PartialMerge<T>,
  a: null | undefined | Record<string, Partial<T>>,
  b: null | undefined | Record<string, Partial<T>>,
): null | Record<string, Partial<T>> {
  if (!a && !b) return null;
  const ret: Record<string, Partial<T>> = {};
  if (a) {
    for (const key in a) {
      ret[key] = a[key];
    }
  }
  if (b) {
    for (const key in b) {
      if (key in ret) {
        ret[key] = merge(ret[key], b[key]);
      } else {
        ret[key] = b[key];
      }
    }
  }
  return ret;
}

export function mergeDduOptions(
  a: DduOptions,
  b: Partial<DduOptions>,
): DduOptions {
  const overwritten: DduOptions = overwrite(a, b);
  const partialMergeUiOptions = partialOverwrite;
  const partialMergeUiParams = partialOverwrite;
  const partialMergeSourceOptions = partialOverwrite;
  const partialMergeSourceParams = partialOverwrite;
  const partialMergeFilterOptions = partialOverwrite;
  const partialMergeFilterParams = partialOverwrite;
  const partialMergeColumnOptions = partialOverwrite;
  const partialMergeColumnParams = partialOverwrite;
  const partialMergeKindOptions = partialOverwrite;
  const partialMergeKindParams = partialOverwrite;
  const partialMergeActionOptions = partialOverwrite;
  const partialMergeActionParams = partialOverwrite;

  return Object.assign(overwritten, {
    uiOptions: migrateEachKeys(
      partialMergeUiOptions,
      a.uiOptions,
      b.uiOptions,
    ) || {},
    uiParams: migrateEachKeys(
      partialMergeUiParams,
      a.uiParams,
      b.uiParams,
    ) || {},
    sourceOptions: migrateEachKeys(
      partialMergeSourceOptions,
      a.sourceOptions,
      b.sourceOptions,
    ) || {},
    sourceParams: migrateEachKeys(
      partialMergeSourceParams,
      a.sourceParams,
      b.sourceParams,
    ) || {},
    filterOptions: migrateEachKeys(
      partialMergeFilterOptions,
      a.filterOptions,
      b.filterOptions,
    ) || {},
    filterParams: migrateEachKeys(
      partialMergeFilterParams,
      a.filterParams,
      b.filterParams,
    ) || {},
    columnOptions: migrateEachKeys(
      partialMergeColumnOptions,
      a.columnOptions,
      b.columnOptions,
    ) || {},
    columnParams: migrateEachKeys(
      partialMergeColumnParams,
      a.columnParams,
      b.columnParams,
    ) || {},
    kindOptions: migrateEachKeys(
      partialMergeKindOptions,
      a.kindOptions,
      b.kindOptions,
    ) || {},
    kindParams: migrateEachKeys(
      partialMergeKindParams,
      a.kindParams,
      b.kindParams,
    ) || {},
    actionOptions: migrateEachKeys(
      partialMergeActionOptions,
      a.actionOptions,
      b.actionOptions,
    ) || {},
    actionParams: migrateEachKeys(
      partialMergeActionParams,
      a.actionParams,
      b.actionParams,
    ) || {},
  });
}

function patchDduOptions(
  a: Partial<DduOptions>,
  b: Partial<DduOptions>,
): Partial<DduOptions> {
  const overwritten: Partial<DduOptions> = { ...a, ...b };

  const uo = migrateEachKeys(
    partialOverwrite,
    a.uiOptions,
    b.uiOptions,
  );
  if (uo) overwritten.uiOptions = uo;

  const so = migrateEachKeys(
    partialOverwrite,
    a.sourceOptions,
    b.sourceOptions,
  );
  if (so) overwritten.sourceOptions = so;

  const fo = migrateEachKeys(
    partialOverwrite,
    a.filterOptions,
    b.filterOptions,
  );
  if (fo) overwritten.filterOptions = fo;

  const co = migrateEachKeys(
    partialOverwrite,
    a.columnOptions,
    b.columnOptions,
  );
  if (co) overwritten.columnOptions = co;

  const ko = migrateEachKeys(
    partialOverwrite,
    a.kindOptions,
    b.kindOptions,
  );
  if (ko) overwritten.kindOptions = ko;

  const ao = migrateEachKeys(
    partialOverwrite,
    a.actionOptions,
    b.actionOptions,
  );
  if (ao) overwritten.actionOptions = ao;

  const up = migrateEachKeys(partialOverwrite, a.uiParams, b.uiParams);
  if (up) overwritten.uiParams = up;
  const sp = migrateEachKeys(partialOverwrite, a.sourceParams, b.sourceParams);
  if (sp) overwritten.sourceParams = sp;
  const fp = migrateEachKeys(partialOverwrite, a.filterParams, b.filterParams);
  if (fp) overwritten.filterParams = fp;
  const cp = migrateEachKeys(partialOverwrite, a.columnParams, b.columnParams);
  if (cp) overwritten.columnParams = cp;
  const kp = migrateEachKeys(partialOverwrite, a.kindParams, b.kindParams);
  if (kp) overwritten.kindParams = kp;
  const ap = migrateEachKeys(partialOverwrite, a.actionParams, b.actionParams);
  if (ap) overwritten.actionParams = ap;

  return overwritten;
}

// Customization by end users
class Custom {
  global: Partial<DduOptions> = {};
  local: Record<string, Partial<DduOptions>> = {};

  get(userOptions: UserOptions): DduOptions {
    const options = foldMerge(mergeDduOptions, defaultDduOptions, [
      this.global,
      userOptions,
    ]);
    const name = options.name;
    const local = this.local[name] || {};
    return foldMerge(mergeDduOptions, defaultDduOptions, [
      this.global,
      local,
      userOptions,
    ]);
  }

  setGlobal(options: Partial<DduOptions>): Custom {
    this.global = options;
    return this;
  }
  setLocal(name: string, options: Partial<DduOptions>): Custom {
    this.local[name] = options;
    return this;
  }
  patchGlobal(options: Partial<DduOptions>): Custom {
    this.global = patchDduOptions(this.global, options);
    return this;
  }
  patchLocal(name: string, options: Partial<DduOptions>): Custom {
    this.local[name] = patchDduOptions(
      this.local[name] || {},
      options,
    );
    return this;
  }
}

export class ContextBuilderImpl implements ContextBuilder {
  #custom: Custom = new Custom();

  async get(
    denops: Denops,
    options: UserOptions,
  ): Promise<[Context, DduOptions]> {
    const userOptions = this.#custom.get(options);

    await this.validate(denops, "options", userOptions, defaultDduOptions());
    for (const key in userOptions.sourceOptions) {
      await this.validate(
        denops,
        "sourceOptions",
        userOptions.sourceOptions[key],
        defaultSourceOptions(),
      );
    }

    const cwd = await fn.getcwd(denops);

    return [
      {
        ...defaultContext(),
        bufName: await fn.bufname(denops, "%"),
        bufNr: await fn.bufnr(denops, "%"),
        cwd,
        mode: await fn.mode(denops),
        path: cwd,
        winId: await fn.win_getid(denops) as number,
      },
      userOptions,
    ];
  }

  async validate(
    denops: Denops,
    name: string,
    options: Record<string, unknown>,
    defaults: Record<string, unknown>,
  ) {
    for (const key in options) {
      if (!(key in defaults)) {
        await printError(denops, `Invalid ${name}: "${key}"`);
      }
    }
  }

  getGlobal(): Partial<DduOptions> {
    return this.#custom.global;
  }
  getLocal(): Record<string, Partial<DduOptions>> {
    return this.#custom.local;
  }

  setGlobal(options: Partial<DduOptions>) {
    this.#custom.setGlobal(options);
  }
  setLocal(name: string, options: Partial<DduOptions>) {
    this.#custom.setLocal(name, options);
  }

  patchGlobal(options: Partial<DduOptions>) {
    this.#custom.patchGlobal(options);
  }
  patchLocal(name: string, options: Partial<DduOptions>) {
    this.#custom.patchLocal(name, options);
  }
}

Deno.test("patchDduOptions", () => {
  const custom = (new Custom())
    .setGlobal({
      sources: [{ name: "file" }],
      sourceParams: {
        "file": {
          maxSize: 300,
        },
      },
    })
    .patchGlobal({
      sources: [{ name: "file" }, { name: "baz" }],
      sourceParams: {
        "baz": {
          foo: "bar",
        },
      },
    });
  assertEquals(custom.global, {
    sources: [{ name: "file" }, { name: "baz" }],
    sourceParams: {
      "file": {
        maxSize: 300,
      },
      "baz": {
        foo: "bar",
      },
    },
  });
});

Deno.test("mergeDduOptions", () => {
  const custom = (new Custom())
    .setGlobal({
      sources: [{ name: "file" }],
      sourceParams: {
        "file": {
          maxSize: 300,
        },
      },
    })
    .setLocal("foo", {
      sources: [{ name: "file" }, { name: "foo" }],
      filterParams: {
        "matcher_head": {
          foo: 3,
        },
        "foo": {
          max: 200,
        },
      },
    })
    .patchLocal("foo", {});
  assertEquals(
    custom.get({
      name: "foo",
    }),
    {
      ...defaultDduOptions(),
      filterOptions: {},
      filterParams: {
        "matcher_head": {
          foo: 3,
        },
        "foo": {
          max: 200,
        },
      },
      kindOptions: {},
      kindParams: {},
      name: "foo",
      sourceOptions: {},
      sourceParams: {
        "file": {
          maxSize: 300,
        },
      },
      sources: [{ name: "file" }, { name: "foo" }],
      uiOptions: {},
      uiParams: {},
    },
  );
});
