import type { BaseParams, DduAliasType, DduExtType } from "./types.ts";
import type { BaseColumn } from "./base/column.ts";
import type { BaseFilter } from "./base/filter.ts";
import type { BaseKind } from "./base/kind.ts";
import type { BaseSource } from "./base/source.ts";
import type { BaseUi } from "./base/ui.ts";
import type { Denops } from "jsr:@denops/std@~7.4.0";
import { isDenoCacheIssueError } from "./utils.ts";
import { mods } from "./_mods.js";

import * as fn from "jsr:@denops/std@~7.4.0/function";
import * as op from "jsr:@denops/std@~7.4.0/option";

import { basename } from "jsr:@std/path@~1.0.2/basename";
import { parse } from "jsr:@std/path@~1.0.2/parse";
import { toFileUrl } from "jsr:@std/path@~1.0.2/to-file-url";
import { Lock } from "jsr:@core/asyncutil@~1.2.0/lock";

type Mod = {
  // deno-lint-ignore no-explicit-any
  mod: any;
  path: string;
};

type Ext = {
  ui: Record<string, BaseUi<BaseParams>>;
  source: Record<string, BaseSource<BaseParams>>;
  filter: Record<string, BaseFilter<BaseParams>>;
  kind: Record<string, BaseKind<BaseParams>>;
  column: Record<string, BaseColumn<BaseParams>>;
};

export class Loader {
  #exts: Ext = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
  };
  #aliases: Record<DduAliasType, Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
    action: {},
  };
  #checkPaths: Record<string, boolean> = {};
  #registerLock = new Lock(0);
  #cachedPaths: Record<string, string> = {};
  #prevRuntimepath = "";

  async initStaticImportPath(denops: Denops) {
    // Generate _mods.ts
    let mods: string[] = [];
    const runtimepath = await op.runtimepath.getGlobal(denops);
    for (
      const glob of [
        "denops/@ddu-columns/*.ts",
        "denops/@ddu-filters/*.ts",
        "denops/@ddu-kinds/*.ts",
        "denops/@ddu-sources/*.ts",
        "denops/@ddu-uis/*.ts",
      ]
    ) {
      mods = mods.concat(
        await fn.globpath(
          denops,
          runtimepath,
          glob,
          1,
          1,
        ),
      );
    }

    const staticLines = [];
    for (const [index, path] of mods.entries()) {
      staticLines.push(
        `import * as mod${index} from "${toFileUrl(path).href}"`,
      );
    }
    staticLines.push("export const mods = {");
    for (const [index, path] of mods.entries()) {
      staticLines.push(`  "${toFileUrl(path).href}":`);
      staticLines.push(`    mod${index},`);
    }
    staticLines.push("};");
    await Deno.writeTextFile(
      await denops.call("ddu#denops#_mods") as string,
      staticLines.join("\n"),
    );
  }

  async autoload(
    denops: Denops,
    type: DduExtType,
    name: string,
  ): Promise<boolean> {
    const runtimepath = await op.runtimepath.getGlobal(denops);
    if (runtimepath !== this.#prevRuntimepath) {
      const cached = await globpath(
        denops,
        "denops/@ddu-*s",
      );
      // NOTE: glob may be invalid.
      if (Object.keys(cached).length > 0) {
        this.#cachedPaths = cached;
      }
      this.#prevRuntimepath = runtimepath;
    }

    const key = `@ddu-${type}s/${this.getAlias(type, name) ?? name}`;

    if (!this.#cachedPaths[key]) {
      return this.#prevRuntimepath === "";
    }

    await this.registerPath(type, this.#cachedPaths[key]);

    // NOTE: this.#prevRuntimepath may be true if initialized.
    // NOTE: If not found, it returns false, .
    return this.#prevRuntimepath === "" || this.#cachedPaths[key] !== undefined;
  }

  registerAlias(type: DduAliasType, alias: string, base: string) {
    this.#aliases[type][alias] = base;
  }

  async registerPath(type: DduExtType, path: string) {
    await this.#registerLock.lock(async () => {
      try {
        await this.#register(type, path);
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
  }

  registerExtension(type: "ui", name: string, ext: BaseUi<BaseParams>): void;
  registerExtension(
    type: "source",
    name: string,
    ext: BaseSource<BaseParams>,
  ): void;
  registerExtension(
    type: "filter",
    name: string,
    ext: BaseFilter<BaseParams>,
  ): void;
  registerExtension(
    type: "kind",
    name: string,
    ext: BaseKind<BaseParams>,
  ): void;
  registerExtension(
    type: "column",
    name: string,
    ext: BaseColumn<BaseParams>,
  ): void;
  registerExtension(
    type: DduExtType,
    name: string,
    ext:
      | BaseUi<BaseParams>
      | BaseSource<BaseParams>
      | BaseFilter<BaseParams>
      | BaseKind<BaseParams>
      | BaseColumn<BaseParams>,
  ) {
    ext.name = name;
    this.#exts[type][name] = ext;
  }

  getUi(name: string): BaseUi<BaseParams> | null {
    return this.#exts.ui[name];
  }
  getSource(name: string): BaseSource<BaseParams> | null {
    return this.#exts.source[name];
  }
  getFilter(name: string): BaseFilter<BaseParams> | null {
    return this.#exts.filter[name];
  }
  getKind(name: string): BaseKind<BaseParams> | null {
    return this.#exts.kind[name];
  }
  getColumn(name: string): BaseColumn<BaseParams> | null {
    return this.#exts.column[name];
  }

  getAlias(type: DduAliasType, name: string): string | undefined {
    return this.#aliases[type][name];
  }
  getAliasNames(type: DduAliasType): string[] {
    return Object.keys(this.#aliases[type]);
  }
  getSourceNames(): string[] {
    return Object.keys(this.#exts.source);
  }

  async #register(type: DduExtType, path: string) {
    if (path in this.#checkPaths) {
      return;
    }

    const name = parse(path).name;

    const mod: Mod = {
      mod: (mods as Record<string, unknown>)[toFileUrl(path).href] ??
        await import(toFileUrl(path).href),
      path,
    };

    const typeExt = this.#exts[type];
    if (type === "ui") {
      const obj = new mod.mod.Ui();
      obj.name = name;
      obj.path = mod.path;
      typeExt[name] = obj;
    } else if (type === "source") {
      const obj = new mod.mod.Source();
      obj.name = name;
      obj.path = mod.path;
      typeExt[name] = obj;
    } else if (type === "filter") {
      const obj = new mod.mod.Filter();
      obj.name = name;
      obj.path = mod.path;
      typeExt[name] = obj;
    } else if (type === "kind") {
      const obj = new mod.mod.Kind();
      obj.name = name;
      obj.path = mod.path;
      typeExt[name] = obj;
    } else if (type === "column") {
      const obj = new mod.mod.Column();
      obj.name = name;
      obj.path = mod.path;
      typeExt[name] = obj;
    }

    // Check alias
    const aliases = this.getAliasNames(type).filter(
      (k) => this.getAlias(type, k) === name,
    );
    for (const alias of aliases) {
      typeExt[alias] = typeExt[name];
    }

    this.#checkPaths[path] = true;
  }
}

async function globpath(
  denops: Denops,
  search: string,
): Promise<Record<string, string>> {
  const runtimepath = await op.runtimepath.getGlobal(denops);

  const paths: Record<string, string> = {};
  const glob = await fn.globpath(
    denops,
    runtimepath,
    search + "/*.ts",
    1,
    1,
  );

  for (const path of glob) {
    // Skip already added name.
    const parsed = parse(path);
    const key = `${basename(parsed.dir)}/${parsed.name}`;
    if (key in paths) {
      continue;
    }

    paths[key] = path;
  }

  return paths;
}
