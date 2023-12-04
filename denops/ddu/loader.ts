import {
  BaseColumn,
  BaseColumnParams,
  BaseFilter,
  BaseFilterParams,
  BaseKind,
  BaseKindParams,
  BaseSource,
  BaseSourceParams,
  BaseUi,
  BaseUiParams,
  ColumnName,
  DduAliasType,
  DduExtType,
  FilterName,
  KindName,
  SourceName,
  UiName,
} from "./types.ts";
import { basename, Denops, fn, Lock, op, parse, toFileUrl } from "./deps.ts";
import { safeStat } from "./utils.ts";
import { mods } from "./_mods.ts";

export type Mod = {
  // deno-lint-ignore no-explicit-any
  mod: any;
  path: string;
};

export class Loader {
  private extensions: Record<string, Extension> = {};
  private mods: Record<DduExtType, Record<string, Mod>> = mods;
  private aliases: Record<DduAliasType, Record<string, string>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
    action: {},
  };
  private checkPaths: Record<string, boolean> = {};
  private registerLock = new Lock(0);
  private cachedPaths: Record<string, string> = {};
  private prevRuntimepath = "";
  private staticImportMod: Record<string, unknown> = {};

  async initStaticImportPath(denops: Denops, path: string) {
    if (Object.values(this.staticImportMod).length !== 0) {
      return;
    }

    path = await fn.expand(denops, path) as string;
    if (!await safeStat(path)) {
      return;
    }

    //const startTime = Date.now();
    this.staticImportMod = (await import(toFileUrl(path).href)).mods;
    //console.log(`${Date.now() - startTime} ms`);
  }

  async autoload(
    denops: Denops,
    type: DduExtType,
    name: string,
  ) {
    const runtimepath = await op.runtimepath.getGlobal(denops);
    if (runtimepath !== this.prevRuntimepath) {
      this.cachedPaths = await globpath(
        denops,
        "denops/@ddu-*s",
      );
      this.prevRuntimepath = runtimepath;
    }

    const key = `@ddu-${type}s/${this.getAlias(type, name) ?? name}`;

    if (!this.cachedPaths[key]) {
      return;
    }

    await this.registerPath(type, this.cachedPaths[key]);
  }

  registerAlias(type: DduAliasType, alias: string, base: string) {
    this.aliases[type][alias] = base;
  }

  async registerPath(type: DduExtType, path: string) {
    await this.registerLock.lock(async () => {
      await this.register(type, path);
    });
  }

  getUi(index: string, name: string): BaseUi<BaseUiParams> | null {
    const mod = this.mods.ui[name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getUi(mod, name);
  }
  getSource(index: string, name: string): BaseSource<BaseSourceParams> | null {
    const mod = this.mods.source[name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getSource(mod, name);
  }
  getFilter(index: string, name: string): BaseFilter<BaseFilterParams> | null {
    const mod = this.mods.filter[name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getFilter(mod, name);
  }
  getKind(index: string, name: string): BaseKind<BaseKindParams> | null {
    const mod = this.mods.kind[name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getKind(mod, name);
  }
  getColumn(index: string, name: string): BaseColumn<BaseColumnParams> | null {
    const mod = this.mods.column[name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getColumn(mod, name);
  }

  getAlias(type: DduAliasType, name: string): string | undefined {
    return this.aliases[type][name];
  }
  getAliasNames(type: DduAliasType) {
    return Object.keys(this.aliases[type]);
  }
  getSourceNames() {
    return Object.keys(this.mods.source);
  }

  private getExtension(index: string): Extension {
    if (!this.extensions[index]) {
      this.extensions[index] = new Extension();
    }

    return this.extensions[index];
  }

  private async register(type: DduExtType, path: string) {
    if (path in this.checkPaths) {
      return;
    }

    const mods = this.mods[type];

    const name = parse(path).name;

    const mod: Mod = mods[name] ?? {
      mod: this.staticImportMod[path] ??
        await import(toFileUrl(path).href),
      path,
    };

    mods[name] = mod;

    // Check alias
    const aliases = this.getAliasNames(type).filter(
      (k) => this.getAlias(type, k) === name,
    );
    for (const alias of aliases) {
      mods[alias] = mod;
    }

    this.checkPaths[path] = true;
  }
}

class Extension {
  private uis: Record<UiName, BaseUi<BaseUiParams>> = {};
  private sources: Record<SourceName, BaseSource<BaseSourceParams>> = {};
  private filters: Record<FilterName, BaseFilter<BaseFilterParams>> = {};
  private kinds: Record<KindName, BaseKind<BaseKindParams>> = {};
  private columns: Record<ColumnName, BaseColumn<BaseColumnParams>> = {};

  getUi(mod: Mod, name: string): BaseUi<BaseUiParams> {
    if (!this.uis[name]) {
      const obj = new mod.mod.Ui();
      obj.name = name;
      obj.path = mod.path;
      this.uis[obj.name] = obj;
    }
    return this.uis[name];
  }
  getSource(mod: Mod, name: string): BaseSource<BaseSourceParams> {
    if (!this.sources[name]) {
      const obj = new mod.mod.Source();
      obj.name = name;
      obj.path = mod.path;
      this.sources[obj.name] = obj;
    }
    return this.sources[name];
  }
  getFilter(mod: Mod, name: string): BaseFilter<BaseFilterParams> {
    if (!this.filters[name]) {
      const obj = new mod.mod.Filter();
      obj.name = name;
      obj.path = mod.path;
      this.filters[obj.name] = obj;
    }
    return this.filters[name];
  }
  getKind(mod: Mod, name: string): BaseKind<BaseKindParams> {
    if (!this.kinds[name]) {
      const obj = new mod.mod.Kind();
      obj.name = name;
      obj.path = mod.path;
      this.kinds[obj.name] = obj;
    }
    return this.kinds[name];
  }
  getColumn(mod: Mod, name: string): BaseColumn<BaseColumnParams> {
    if (!this.columns[name]) {
      const obj = new mod.mod.Column();
      obj.name = name;
      obj.path = mod.path;
      this.columns[obj.name] = obj;
    }
    return this.columns[name];
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
