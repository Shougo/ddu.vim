import { assertEquals } from "./deps.ts";
import { DduOptions, FilterOptions, SourceOptions } from "./types.ts";

// where
// T: Object
// partialMerge: PartialMerge
// partialMerge(partialMerge(a, b), c) == partialMerge(a, partialMerge(b, c))
type PartialMerge<T> = (a: Partial<T>, b: Partial<T>) => Partial<T>;
type Merge<T> = (a: T, b: Partial<T>) => T;
type Default<T> = () => T;

function partialOverwrite<T>(a: Partial<T>, b: Partial<T>): Partial<T> {
  return { ...a, ...b };
}

function overwrite<T>(a: T, b: Partial<T>): T {
  return { ...a, ...b };
}
export const mergeSourceOptions: Merge<SourceOptions> = overwrite;
export const mergeFilterOptions: Merge<FilterOptions> = overwrite;
export const mergeSourceParams: Merge<Record<string, unknown>> = overwrite;
export const mergeFilterParams: Merge<Record<string, unknown>> = overwrite;

export function foldMerge<T>(
  merge: Merge<T>,
  def: Default<T>,
  partials: (null | undefined | Partial<T>)[],
): T {
  return partials.map((x) => x || {}).reduce(merge, def());
}

export function defaultDduOptions(): DduOptions {
  return {
    sources: [],
    filterOptions: {},
    filterParams: {},
    sourceOptions: {},
    sourceParams: {},
  };
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
  const partialMergeSourceOptions = partialOverwrite;
  const partialMergeSourceParams = partialOverwrite;
  const partialMergeFilterOptions = partialOverwrite;
  const partialMergeFilterParams = partialOverwrite;
  return Object.assign(overwritten, {
    sourceOptions: migrateEachKeys(
      partialMergeSourceOptions,
      a.sourceOptions,
      b.sourceOptions,
    ) || {},
    filterOptions: migrateEachKeys(
      partialMergeFilterOptions,
      a.filterOptions,
      b.filterOptions,
    ) || {},
    sourceParams: migrateEachKeys(
      partialMergeSourceParams,
      a.sourceParams,
      b.sourceParams,
    ) || {},
    filterParams: migrateEachKeys(
      partialMergeFilterParams,
      a.filterParams,
      b.filterParams,
    ) || {},
  });
}

function patchDduOptions(
  a: Partial<DduOptions>,
  b: Partial<DduOptions>,
): Partial<DduOptions> {
  const overwritten: Partial<DduOptions> = { ...a, ...b };
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
  const sp = migrateEachKeys(partialOverwrite, a.sourceParams, b.sourceParams);
  if (sp) overwritten.sourceParams = sp;
  const fp = migrateEachKeys(partialOverwrite, a.filterParams, b.filterParams);
  if (fp) overwritten.filterParams = fp;
  return overwritten;
}

// Customization by end users
class Custom {
  global: Partial<DduOptions> = {};
  buffer: Record<string, Partial<DduOptions>> = {};

  get(options: Record<string, unknown>): DduOptions {
    const buffer =
      ("bufferName" in options && this.buffer[options.bufferName as string]) ||
      {};
    return foldMerge(mergeDduOptions, defaultDduOptions, [
      this.global,
      buffer,
      options,
    ]);
  }

  setGlobal(options: Partial<DduOptions>): Custom {
    this.global = options;
    return this;
  }
  setBuffer(bufferName: string, options: Partial<DduOptions>): Custom {
    this.buffer[bufferName] = options;
    return this;
  }
  patchGlobal(options: Partial<DduOptions>): Custom {
    this.global = patchDduOptions(this.global, options);
    return this;
  }
  patchBuffer(bufferName: string, options: Partial<DduOptions>): Custom {
    this.buffer[bufferName] = patchDduOptions(
      this.buffer[bufferName] || {},
      options,
    );
    return this;
  }
}

export class ContextBuilder {
  private custom: Custom = new Custom();

  get(options: Record<string, unknown>): DduOptions {
    return this.custom.get(options);
  }

  getGlobal(): Partial<DduOptions> {
    return this.custom.global;
  }
  getBuffer(): Record<number, Partial<DduOptions>> {
    return this.custom.buffer;
  }

  setGlobal(options: Partial<DduOptions>) {
    this.custom.setGlobal(options);
  }
  setBuffer(bufferName: string, options: Partial<DduOptions>) {
    this.custom.setBuffer(bufferName, options);
  }

  patchGlobal(options: Partial<DduOptions>) {
    this.custom.patchGlobal(options);
  }
  patchBuffer(bufferName: string, options: Partial<DduOptions>) {
    this.custom.patchBuffer(bufferName, options);
  }
}

Deno.test("patchDduOptions", () => {
  const custom = (new Custom())
    .setGlobal({
      sources: ["file"],
      sourceParams: {
        "file": {
          maxSize: 300,
        },
      },
    })
    .patchGlobal({
      sources: ["file", "baz"],
      sourceParams: {
        "baz": {
          foo: "bar",
        },
      },
    });
  assertEquals(custom.global, {
    sources: ["file", "baz"],
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
      sources: ["file"],
      sourceParams: {
        "file": {
          maxSize: 300,
        },
      },
    })
    .setBuffer("foo", {
      sources: ["file", "foo"],
      filterParams: {
        "matcher_head": {
          foo: 3,
        },
        "foo": {
          max: 200,
        },
      },
    })
    .patchBuffer("foo", {});
  assertEquals(custom.get({}), {
    ...defaultDduOptions(),
    sources: ["file", "foo"],
    sourceOptions: {},
    filterOptions: {},
    sourceParams: {
      "file": {
        maxSize: 300,
      },
    },
    filterParams: {
      "matcher_head": {
        foo: 3,
      },
      "foo": {
        max: 200,
      },
    },
  });
  assertEquals(custom.get({}), {
    ...defaultDduOptions(),
    sources: [],
    sourceOptions: {},
    filterOptions: {},
    sourceParams: {
      "file": {
        maxSize: 300,
      },
    },
    filterParams: {
      "matcher_head": {
        foo: 2,
      },
    },
  });
  assertEquals(custom.get({}), {
    ...defaultDduOptions(),
    sources: ["file", "foo"],
    sourceOptions: {},
    filterOptions: {},
    sourceParams: {
      "file": {
        maxSize: 300,
      },
    },
    filterParams: {
      "matcher_head": {
        foo: 3,
      },
      "foo": {
        max: 200,
      },
    },
  });
});
