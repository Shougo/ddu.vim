import { Context, DduOptions, Item, SourceOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export type OnEventArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export type GatherArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  sourceParams: Params;
  completeStr: string;
};

export abstract class BaseSource<
  Params extends Record<string, unknown>,
  UserData extends unknown = unknown,
> {
  name = "";

  isInitialized = false;

  apiVersion = 1;

  kind = "base";

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  abstract gather(
    {}: GatherArguments<Params>,
  ): Promise<ReadableStream<Item<UserData>[]>>;

  abstract params(): Params;
}

export function defaultSourceOptions(): SourceOptions {
  return {
    matcherKey: "word",
  };
}

export function defaultSourceParams(): Record<string, unknown> {
  return {};
}
