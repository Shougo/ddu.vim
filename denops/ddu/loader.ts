import type {
  BaseParams,
  ColumnName,
  DduAliasType,
  DduExtType,
  FilterName,
  KindName,
  SourceName,
  UiName,
} from "./types.ts";
import type { BaseColumn } from "./base/column.ts";
import type { BaseFilter } from "./base/filter.ts";
import type { BaseKind } from "./base/kind.ts";
import type { BaseSource } from "./base/source.ts";
import type { BaseUi } from "./base/ui.ts";
import type { Denops } from "jsr:@denops/std@~7.3.0";
import { isDenoCacheIssueError } from "./utils.ts";
import { mods } from "./_mods.js";

import * as fn from "jsr:@denops/std@~7.3.0/function";
import * as op from "jsr:@denops/std@~7.3.0/option";

import { basename } from "jsr:@std/path@~1.0.2/basename";
import { parse } from "jsr:@std/path@~1.0.2/parse";
import { toFileUrl } from "jsr:@std/path@~1.0.2/to-file-url";
import { Lock } from "jsr:@core/asyncutil@~1.2.0/lock";

type Mod = {
  // deno-lint-ignore no-explicit-any
  mod: any;
  path: string;
};

export class Loader {
  #extensions: Record<string, Extension> = {};
  #mods: Record<DduExtType, Record<string, Mod>> = {
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

  getUi(index: string, name: string): BaseUi<BaseParams> | null {
    const mod = this.#mods.ui[name];
    if (!mod) {
      return null;
    }

    return this.#getExtension(index).getUi(mod, name);
  }
  getSource(index: string, name: string): BaseSource<BaseParams> | null {
    const mod = this.#mods.source[name];
    if (!mod) {
      return null;
    }

    return this.#getExtension(index).getSource(mod, name);
  }
  getFilter(index: string, name: string): BaseFilter<BaseParams> | null {
    const mod = this.#mods.filter[name];
    if (!mod) {
      return null;
    }

    return this.#getExtension(index).getFilter(mod, name);
  }
  getKind(index: string, name: string): BaseKind<BaseParams> | null {
    const mod = this.#mods.kind[name];
    if (!mod) {
      return null;
    }

    return this.#getExtension(index).getKind(mod, name);
  }
  getColumn(index: string, name: string): BaseColumn<BaseParams> | null {
    const mod = this.#mods.column[name];
    if (!mod) {
      return null;
    }

    return this.#getExtension(index).getColumn(mod, name);
  }

  getAlias(type: DduAliasType, name: string): string | undefined {
    return this.#aliases[type][name];
  }
  getAliasNames(type: DduAliasType): string[] {
    return Object.keys(this.#aliases[type]);
  }
  getSourceNames(): string[] {
    return Object.keys(this.#mods.source);
  }

  #getExtension(index: string): Extension {
    if (!this.#extensions[index]) {
      this.#extensions[index] = new Extension();
    }

    return this.#extensions[index];
  }

  async #register(type: DduExtType, path: string) {
    if (path in this.#checkPaths) {
      return;
    }

    const typeMods = this.#mods[type];

    const name = parse(path).name;

    const mod: Mod = {
      mod: (mods as Record<string, unknown>)[toFileUrl(path).href] ??
        await import(toFileUrl(path).href),
      path,
    };

    typeMods[name] = mod;

    // Check alias
    const aliases = this.getAliasNames(type).filter(
      (k) => this.getAlias(type, k) === name,
    );
    for (const alias of aliases) {
      typeMods[alias] = mod;
    }

    this.#checkPaths[path] = true;
  }
}

class Extension {
  #uis: Record<UiName, BaseUi<BaseParams>> = {};
  #sources: Record<SourceName, BaseSource<BaseParams>> = {};
  #filters: Record<FilterName, BaseFilter<BaseParams>> = {};
  #kinds: Record<KindName, BaseKind<BaseParams>> = {};
  #columns: Record<ColumnName, BaseColumn<BaseParams>> = {};

  getUi(mod: Mod, name: string): BaseUi<BaseParams> {
    if (!this.#uis[name]) {
      const obj = new mod.mod.Ui();
      obj.name = name;
      obj.path = mod.path;
      this.#uis[obj.name] = obj;
    }
    return this.#uis[name];
  }
  getSource(mod: Mod, name: string): BaseSource<BaseParams> {
    if (!this.#sources[name]) {
      const obj = new mod.mod.Source();
      obj.name = name;
      obj.path = mod.path;
      this.#sources[obj.name] = obj;
    }
    return this.#sources[name];
  }
  getFilter(mod: Mod, name: string): BaseFilter<BaseParams> {
    if (!this.#filters[name]) {
      const obj = new mod.mod.Filter();
      obj.name = name;
      obj.path = mod.path;
      this.#filters[obj.name] = obj;
    }
    return this.#filters[name];
  }
  getKind(mod: Mod, name: string): BaseKind<BaseParams> {
    if (!this.#kinds[name]) {
      const obj = new mod.mod.Kind();
      obj.name = name;
      obj.path = mod.path;
      this.#kinds[obj.name] = obj;
    }
    return this.#kinds[name];
  }
  getColumn(mod: Mod, name: string): BaseColumn<BaseParams> {
    if (!this.#columns[name]) {
      const obj = new mod.mod.Column();
      obj.name = name;
      obj.path = mod.path;
      this.#columns[obj.name] = obj;
    }
    return this.#columns[name];
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
