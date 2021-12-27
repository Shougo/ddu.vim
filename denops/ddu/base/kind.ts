import { Context, DduItem, DduOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type ActionArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context?: Context;
  options?: DduOptions;
  kindParams?: Params;
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

export function defaultUiParams(): Record<string, unknown> {
  return {};
}
