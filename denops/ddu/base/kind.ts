import { DduItem, DduOptions, KindOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type ActionArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  kindOptions: KindOptions;
  kindParams: Params;
  actionParams: unknown;
  items: DduItem[];
};

export abstract class BaseKind<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  actions: Record<string, (args: ActionArguments<Params>) => Promise<void>> =
    {};

  abstract params(): Params;
}

export function defaultKindOptions(): KindOptions {
  return {
    defaultAction: "",
  };
}
export function defaultKindParams(): Record<string, unknown> {
  return {};
}
