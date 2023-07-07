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
import { Denops, fn, Lock, op, parse, toFileUrl } from "./deps.ts";

export class Loader {
  private extensions: Record<string, Extension> = {};
  private mods: Record<DduExtType, Record<string, unknown>> = {
    ui: {},
    source: {},
    filter: {},
    kind: {},
    column: {},
  };
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

  async autoload(
    denops: Denops,
    type: DduExtType,
    name: string,
  ) {
    const paths = await globpath(
      denops,
      `denops/@ddu-${type}s/`,
      this.getAlias(type, name) ?? name,
    );

    if (paths.length === 0) {
      return;
    }

    await this.registerPath(type, paths[0]);
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
    const mod = this.mods["ui"][name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getUi(mod, name);
  }
  getSource(index: string, name: string): BaseSource<BaseSourceParams> | null {
    const mod = this.mods["source"][name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getSource(mod, name);
  }
  getFilter(index: string, name: string): BaseFilter<BaseFilterParams> | null {
    const mod = this.mods["filter"][name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getFilter(mod, name);
  }
  getKind(index: string, name: string): BaseKind<BaseKindParams> | null {
    const mod = this.mods["kind"][name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getKind(mod, name);
  }
  getColumn(index: string, name: string): BaseColumn<BaseColumnParams> | null {
    const mod = this.mods["column"][name];
    if (!mod) {
      return null;
    }

    return this.getExtension(index).getColumn(mod, name);
  }

  getAlias(type: DduAliasType, name: string) {
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

    const name = parse(path).name;

    const mod = await import(toFileUrl(path).href);

    this.mods[type][name] = mod;

    // Check alias
    const aliases = this.getAliasNames(type).filter(
      (k) => this.getAlias(type, k) === name,
    );
    for (const alias of aliases) {
      this.mods[type][alias] = mod;
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

  // deno-lint-ignore no-explicit-any
  getUi(mod: any, name: string): BaseUi<BaseUiParams> {
    if (!this.uis[name]) {
      const obj = new mod.Ui();
      obj.name = name;
      this.uis[obj.name] = obj;
    }
    return this.uis[name];
  }
  // deno-lint-ignore no-explicit-any
  getSource(mod: any, name: string): BaseSource<BaseSourceParams> {
    if (!this.sources[name]) {
      const obj = new mod.Source();
      obj.name = name;
      this.sources[obj.name] = obj;
    }
    return this.sources[name];
  }
  // deno-lint-ignore no-explicit-any
  getFilter(mod: any, name: string): BaseFilter<BaseFilterParams> {
    if (!this.filters[name]) {
      const obj = new mod.Filter();
      obj.name = name;
      this.filters[obj.name] = obj;
    }
    return this.filters[name];
  }
  // deno-lint-ignore no-explicit-any
  getKind(mod: any, name: string): BaseKind<BaseKindParams> {
    if (!this.kinds[name]) {
      const obj = new mod.Kind();
      obj.name = name;
      this.kinds[obj.name] = obj;
    }
    return this.kinds[name];
  }
  // deno-lint-ignore no-explicit-any
  getColumn(mod: any, name: string): BaseColumn<BaseColumnParams> {
    if (!this.columns[name]) {
      const obj = new mod.Column();
      obj.name = name;
      this.columns[obj.name] = obj;
    }
    return this.columns[name];
  }
}

async function globpath(
  denops: Denops,
  search: string,
  file: string,
): Promise<string[]> {
  const runtimepath = await op.runtimepath.getGlobal(denops);

  const check: Record<string, boolean> = {};
  const paths: string[] = [];
  const glob = await fn.globpath(
    denops,
    runtimepath,
    search + file + ".ts",
    1,
    1,
  );

  for (const path of glob) {
    // Skip already added name.
    if (parse(path).name in check) {
      continue;
    }

    paths.push(path);
    check[parse(path).name] = true;
  }

  return paths;
}
