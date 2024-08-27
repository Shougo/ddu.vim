import type {
  Actions,
  BaseParams,
  Context,
  DduEvent,
  DduItem,
  DduOptions,
  Item,
  SourceOptions,
} from "../types.ts";

import type { Denops } from "jsr:@denops/std@~7.1.0";

export type OnInitArguments<Params extends BaseParams> = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export type OnEventArguments<Params extends BaseParams> = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  event: DduEvent;
};

export type GatherArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  input: string;
  parent?: DduItem;
};

export type CheckUpdatedArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export abstract class BaseSource<
  Params extends BaseParams,
  UserData extends unknown = unknown,
> {
  apiVersion = 3;

  name = "";
  path = "";
  isInitialized = false;

  kind = "base";
  prevMtime: Date = new Date();
  actions: Actions<Params> = {};

  onInit(_args: OnInitArguments<Params>): void | Promise<void> {}

  onEvent(_args: OnEventArguments<Params>): void | Promise<void> {}

  abstract gather(
    {}: GatherArguments<Params>,
  ): ReadableStream<Item<UserData>[]>;

  checkUpdated(
    _args: CheckUpdatedArguments<Params>,
  ): boolean | Promise<boolean> {
    return false;
  }

  abstract params(): Params;
}

export function defaultSourceOptions(): SourceOptions {
  return {
    actions: {},
    columns: [],
    converters: [],
    defaultAction: "",
    ignoreCase: false,
    matcherKey: "word",
    matchers: [],
    maxItems: 10000,
    path: "",
    preview: true,
    smartCase: false,
    sorters: [],
    volatile: false,
  };
}
