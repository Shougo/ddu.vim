import type { Denops } from "jsr:@denops/std@~7.6.0";
import { SEPARATOR as pathsep } from "jsr:@std/path@~1.1.0/constants";
import type { TreePath } from "./types.ts";

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
