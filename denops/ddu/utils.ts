import type {
  Callback,
  Context,
  DduItem,
  DduOptions,
  Filters,
  SourceOptions,
  TreePath,
} from "./types.ts";

import type { Denops } from "@denops/std";

import { SEPARATOR as pathsep } from "@std/path/constants";
import {
  type ImportMap,
  ImportMapImporter,
  loadImportMap,
} from "@lambdalisue/import-map-importer";
import { is } from "@core/unknownutil/is";
import { toFileUrl } from "@std/path/to-file-url";
import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";
import { dirname } from "@std/path/dirname";

export async function printError(
  denops: Denops,
  ...messages: unknown[]
) {
  const message = messages.map((v) => {
    if (v instanceof Error) {
      // NOTE: In Deno, Prefer `Error.stack` because it contains `Error.message`.
      return `${v.stack ?? v}`;
    } else if (typeof v === "object") {
      return JSON.stringify(v);
    } else {
      return `${v}`;
    }
  }).join("\n");
  await denops.call("ddu#util#print_error", message);
}

export async function printLog(
  denops: Denops,
  ...messages: unknown[]
) {
  const message = messages.map((v) => {
    if (v instanceof Error) {
      // NOTE: In Deno, Prefer `Error.stack` because it contains `Error.message`.
      return `${v.stack ?? v}`;
    } else if (typeof v === "object") {
      return JSON.stringify(v);
    } else {
      return `${v}`;
    }
  }).join("\n");
  await denops.call("ddu#util#print_log", message);
}

// See https://github.com/vim-denops/denops.vim/issues/358 for details
export function isDenoCacheIssueError(e: unknown): boolean {
  const expects = [
    "Could not find constraint in the list of versions: ", // Deno 1.40?
    "Could not find version of ", // Deno 1.38
  ] as const;
  if (e instanceof TypeError) {
    return expects.some((expect) => e.message.startsWith(expect));
  }
  return false;
}

export function treePath2Filename(treePath: TreePath): string {
  return typeof treePath === "string" ? treePath : treePath.join(pathsep);
}

export function convertTreePath(treePath?: TreePath): string[] {
  return typeof treePath === "string"
    ? treePath.split(pathsep)
    : !treePath
    ? []
    : treePath;
}

export async function safeStat(path: string): Promise<Deno.FileInfo | null> {
  // NOTE: Deno.stat() may be failed
  try {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      try {
        const stat = await Deno.stat(path);
        stat.isSymlink = true;
        return stat;
      } catch (_: unknown) {
        // Ignore stat exception
      }
    }
    return stat;
  } catch (_: unknown) {
    // Ignore stat exception
  }
  return null;
}

export function convertUserString<T>(
  user: string | T,
): T | { name: string | (T & string) } {
  return typeof user === "string" ? { name: user } : user;
}

export async function tryLoadImportMap(
  script: string,
): Promise<ImportMap | undefined> {
  if (script.startsWith("http://") || script.startsWith("https://")) {
    // We cannot load import maps for remote scripts
    return undefined;
  }
  const PATTERNS = [
    "deno.json",
    "deno.jsonc",
    "import_map.json",
    "import_map.jsonc",
  ];
  // Convert file URL to path for file operations
  const scriptPath = script.startsWith("file://")
    ? fromFileUrl(new URL(script))
    : script;
  const parentDir = dirname(scriptPath);
  for (const pattern of PATTERNS) {
    const importMapPath = join(parentDir, pattern);
    try {
      return await loadImportMap(importMapPath);
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        // Ignore NotFound errors and try the next pattern
        continue;
      }
      throw err; // Rethrow other errors
    }
  }
  return undefined;
}

export async function importPlugin(path: string): Promise<unknown> {
  // Import module with fragment so that reload works properly
  // https://github.com/vim-denops/denops.vim/issues/227
  const suffix = performance.now();
  const url = toFileUrl(path).href;
  const importMap = await tryLoadImportMap(path);
  if (importMap) {
    const importer = new ImportMapImporter(importMap);
    return await importer.import(`${url}#${suffix}`);
  } else {
    return await import(`${url}#${suffix}`);
  }
}

export async function callCallback(
  denops: Denops | null,
  callback: Callback,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  if (!denops || !callback) {
    return null;
  }

  if (is.String(callback)) {
    if (callback === "") {
      return null;
    }

    return await denops.call(
      "denops#callback#call",
      callback,
      args,
    );
  } else {
    return await callback(denops, args);
  }
}

// Whether globalThis.structuredClone is available (Deno 1.14+, Node 18+)
const structuredCloneAvailable = typeof (globalThis as Record<string, unknown>)
  .structuredClone === "function";

// Warn once if falling back to JSON-based deep clone
let _cowFallbackWarned = false;

/**
 * Deep-clone a single item.
 * Prefers structuredClone; falls back to JSON round-trip as last resort.
 */
function deepCloneItem<T>(item: T): T {
  if (structuredCloneAvailable) {
    return structuredClone(item);
  }
  if (!_cowFallbackWarned) {
    _cowFallbackWarned = true;
    // NOTE: JSON round-trip cannot handle undefined, Date, RegExp, etc.
    console.warn(
      "[ddu] structuredClone unavailable; COW falling back to JSON deep clone. " +
        "Some item properties may be lost.",
    );
  }
  return JSON.parse(JSON.stringify(item)) as T;
}

/**
 * Wrap each item in a Proxy that clones on first write (Copy-On-Write).
 *
 * Returns a tuple:
 *   [proxiedItems, getCloneCount, resetCloneCount]
 *
 * - proxiedItems    : array of COW-proxied DduItem values.
 * - getCloneCount() : returns the total number of items actually cloned so far.
 * - resetCloneCount(): resets the internal counter to 0.
 */
export function cowifyItems(
  items: DduItem[],
): [DduItem[], () => number, () => void] {
  let cloneCount = 0;

  const proxied = items.map((originalItem) => {
    // clonedItem holds the lazy copy; null means not yet cloned.
    let clonedItem: DduItem | null = null;

    const ensureClone = () => {
      if (!clonedItem) {
        cloneCount++;
        clonedItem = deepCloneItem(originalItem);
      }
    };

    return new Proxy(originalItem, {
      get(_target, prop, receiver) {
        // Read from cloned copy when available, otherwise from original.
        const source = clonedItem ?? originalItem;
        return Reflect.get(source, prop, receiver);
      },
      set(_target, prop, value) {
        ensureClone();
        // Write directly to the cloned copy (use clonedItem as receiver to
        // avoid re-entering this proxy through a possible inherited setter).
        return Reflect.set(clonedItem!, prop, value, clonedItem!);
      },
      has(_target, prop) {
        return Reflect.has(clonedItem ?? originalItem, prop);
      },
      deleteProperty(_target, prop) {
        ensureClone();
        return Reflect.deleteProperty(clonedItem!, prop);
      },
      defineProperty(_target, prop, descriptor) {
        ensureClone();
        return Reflect.defineProperty(clonedItem!, prop, descriptor);
      },
      ownKeys(_target) {
        return Reflect.ownKeys(clonedItem ?? originalItem);
      },
      getOwnPropertyDescriptor(_target, prop) {
        return Reflect.getOwnPropertyDescriptor(
          clonedItem ?? originalItem,
          prop,
        );
      },
      getPrototypeOf(_target) {
        return Reflect.getPrototypeOf(clonedItem ?? originalItem);
      },
      setPrototypeOf(_target, proto) {
        ensureClone();
        return Reflect.setPrototypeOf(clonedItem!, proto);
      },
    });
  }) as DduItem[];

  return [
    proxied,
    () => cloneCount,
    () => {
      cloneCount = 0;
    },
  ];
}

export async function getFilters(
  denops: Denops,
  context: Context,
  options: DduOptions,
  sourceOptions: SourceOptions,
  input: string,
  items: DduItem[],
): Promise<Filters> {
  const filters: Filters = {
    matchers: sourceOptions.matchers,
    sorters: sourceOptions.sorters,
    converters: sourceOptions.converters,
  };

  const dynamicFilters = await callCallback(
    denops,
    sourceOptions.dynamicFilters,
    {
      context,
      options,
      sourceOptions,
      input,
      items,
    },
  ) as Filters | null;
  if (dynamicFilters) {
    if (dynamicFilters.matchers) {
      filters.matchers = dynamicFilters.matchers;
    }
    if (dynamicFilters.sorters) {
      filters.sorters = dynamicFilters.sorters;
    }
    if (dynamicFilters.converters) {
      filters.converters = dynamicFilters.converters;
    }
  }

  return filters;
}
