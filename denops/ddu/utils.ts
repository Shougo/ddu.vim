import { Denops, pathsep } from "./deps.ts";
import { TreePath } from "./types.ts";

export function treePath2Filename(treePath: TreePath) {
  return typeof treePath === "string" ? treePath : treePath.join(pathsep);
}

export async function errorException(
  denops: Denops,
  e: unknown,
  message: string,
) {
  await denops.call(
    "ddu#util#print_error",
    message,
  );
  if (e instanceof Error) {
    await denops.call(
      "ddu#util#print_error",
      e.message,
    );
    if (e.stack) {
      await denops.call(
        "ddu#util#print_error",
        e.stack,
      );
    }
  } else {
    await denops.call(
      "ddu#util#print_error",
      "unknown error object",
    );
    console.error(e);
  }
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
