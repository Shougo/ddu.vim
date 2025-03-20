import type { BaseParams, DduAliasType, DduExtType } from "./types.ts";
import type { BaseColumn } from "./base/column.ts";
import type { BaseFilter } from "./base/filter.ts";
import type { BaseKind } from "./base/kind.ts";
import type { BaseSource } from "./base/source.ts";
import type { BaseUi } from "./base/ui.ts";
import type { Denops } from "jsr:@denops/std@~7.5.0";
import { isDenoCacheIssueError } from "./utils.ts";

import * as fn from "jsr:@denops/std@~7.5.0/function";
import * as op from "jsr:@denops/std@~7.5.0/option";

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
        this.#prevRuntimepath = runtimepath;
      }
    }

    const key = `@ddu-${type}s/${this.getAlias(type, name) ?? name}`;

    if (!this.#cachedPaths[key]) {
      return this.#prevRuntimepath === "";
    }

    await this.registerPath(type, this.#cachedPaths[key]);

    // NOTE: this.#prevRuntimepath may be true if initialized.
    // NOTE: If not found, it returns false.
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

  async getUi(
    denops: Denops,
    name: string,
  ): Promise<BaseUi<BaseParams> | null> {
    if (!this.#exts.ui[name]) {
      await this.autoload(denops, "ui", name);
    }

    return this.#exts.ui[name];
  }
  // NOTE: It must not async
  getSource(name: string): BaseSource<BaseParams> {
    return this.#exts.source[name];
  }
  async getFilter(
    denops: Denops,
    name: string,
  ): Promise<BaseFilter<BaseParams> | null> {
    if (!this.#exts.filter[name]) {
      await this.autoload(denops, "filter", name);
    }

    return this.#exts.filter[name];
  }
  async getKind(
    denops: Denops,
    name: string,
  ): Promise<BaseKind<BaseParams> | null> {
    if (!this.#exts.kind[name]) {
      await this.autoload(denops, "kind", name);
    }

    return this.#exts.kind[name];
  }
  async getColumn(
    denops: Denops,
    name: string,
  ): Promise<BaseColumn<BaseParams> | null> {
    if (!this.#exts.column[name]) {
      await this.autoload(denops, "column", name);
    }

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
      mod: await import(toFileUrl(path).href),
      path,
    };

    const typeExt = this.#exts[type];
    let add;
    switch (type) {
      case "ui":
        add = (name: string) => {
          const ext = new mod.mod.Ui();
          ext.name = name;
          ext.path = mod.path;
          typeExt[name] = ext;
        };
        break;
      case "source":
        add = (name: string) => {
          const ext = new mod.mod.Source();
          ext.name = name;
          ext.path = mod.path;
          typeExt[name] = ext;
        };
        break;
      case "filter":
        add = (name: string) => {
          const ext = new mod.mod.Filter();
          ext.name = name;
          ext.path = mod.path;
          typeExt[name] = ext;
        };
        break;
      case "kind":
        add = (name: string) => {
          const ext = new mod.mod.Kind();
          ext.name = name;
          ext.path = mod.path;
          typeExt[name] = ext;
        };
        break;
      case "column":
        add = (name: string) => {
          const ext = new mod.mod.Column();
          ext.name = name;
          ext.path = mod.path;
          typeExt[name] = ext;
        };
        break;
    }

    add(name);

    // Check alias
    const aliases = this.getAliasNames(type).filter(
      (k) => this.getAlias(type, k) === name,
    );
    for (const alias of aliases) {
      add(alias);
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
