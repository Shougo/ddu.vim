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
