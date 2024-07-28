import type { Denops } from "./deps.ts";
import { pathsep } from "./deps.ts";
import type { TreePath } from "./types.ts";

export function treePath2Filename(treePath: TreePath): string {
  return typeof treePath === "string" ? treePath : treePath.join(pathsep);
}

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
