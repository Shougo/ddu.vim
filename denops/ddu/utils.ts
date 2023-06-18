import { pathsep } from "./deps.ts";
import { TreePath } from "./types.ts";

export function treePath2Filename(treePath: TreePath) {
  return typeof treePath === "string" ? treePath : treePath.join(pathsep);
}
