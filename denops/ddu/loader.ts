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
  DduAliasType,
  DduExtType,
} from "./types.ts";
import { Lock, parse, toFileUrl } from "./deps.ts";

export class Loader {
  private uis: Record<string, BaseUi<BaseUiParams>> = {};
  private sources: Record<string, BaseSource<BaseSourceParams>> = {};
  private filters: Record<string, BaseFilter<BaseFilterParams>> = {};
  private kinds: Record<string, BaseKind<BaseKindParams>> = {};
  private columns: Record<string, BaseColumn<BaseColumnParams>> = {};
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

  registerAlias(type: DduAliasType, alias: string, base: string) {
    this.aliases[type][alias] = base;
  }

  async registerPath(type: DduExtType, path: string) {
    await this.registerLock.lock(async () => {
      await this.register(type, path);
    });
  }

  getAliasNames(type: DduAliasType) {
    return Object.keys(this.aliases[type]);
  }
  getAlias(type: DduAliasType, name: string) {
    return this.aliases[type][name];
  }
  getUi(name: string) {
    return this.uis[name];
  }
  getSourceNames() {
    return Object.keys(this.sources);
  }
  getSource(name: string) {
    return this.sources[name];
  }
  getFilter(name: string) {
    return this.filters[name];
  }
  getKind(name: string) {
    return this.kinds[name];
  }
  getColumn(name: string) {
    return this.columns[name];
  }

  private async register(type: DduExtType, path: string) {
    if (path in this.checkPaths) {
      return;
    }

    const name = parse(path).name;

    const mod = await import(toFileUrl(path).href);

    let add;
    switch (type) {
      case "ui":
        add = (name: string) => {
          const obj = new mod.Ui();
          obj.name = name;
          obj.path = path;
          this.uis[obj.name] = obj;
        };
        break;
      case "source":
        add = (name: string) => {
          const obj = new mod.Source();
          obj.name = name;
          obj.path = path;
          this.sources[obj.name] = obj;
        };
        break;
      case "filter":
        add = (name: string) => {
          const obj = new mod.Filter();
          obj.name = name;
          obj.path = path;
          this.filters[obj.name] = obj;
        };
        break;
      case "kind":
        add = (name: string) => {
          const obj = new mod.Kind();
          obj.name = name;
          obj.path = path;
          this.kinds[obj.name] = obj;
        };
        break;
      case "column":
        add = (name: string) => {
          const obj = new mod.Column();
          obj.name = name;
          obj.path = path;
          this.columns[obj.name] = obj;
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

    this.checkPaths[path] = true;
  }
}
