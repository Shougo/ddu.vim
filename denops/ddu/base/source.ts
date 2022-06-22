import {
  Actions,
  Context,
  DduEvent,
  DduOptions,
  Item,
  SourceOptions,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export type OnEventArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  event: DduEvent;
};

export type GatherArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  input: string;
};

export type CheckUpdatedArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export abstract class BaseSource<
  Params extends Record<string, unknown>,
  UserData extends unknown = unknown,
> {
  name = "";

  isInitialized = false;

  apiVersion = 2;

  kind = "base";

  prevMtime = -1;

  actions: Actions<Params> = {};

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  async onEvent(_args: OnEventArguments<Params>): Promise<void> {}

  abstract gather(
    {}: GatherArguments<Params>,
  ): ReadableStream<Item<UserData>[]>;

  // deno-lint-ignore require-await
  async checkUpdated(_args: CheckUpdatedArguments<Params>): Promise<boolean> {
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
    sorters: [],
  };
}

export function defaultSourceParams(): Record<string, unknown> {
  return {};
}
