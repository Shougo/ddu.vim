import { ActionArguments, ActionFlags, KindOptions } from "../types.ts";

export abstract class BaseKind<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  actions: Record<
    string,
    (args: ActionArguments<Params>) => Promise<ActionFlags>
  > = {};

  abstract params(): Params;
}

export function defaultKindOptions(): KindOptions {
  return {
    actions: {},
    defaultAction: "",
  };
}
export function defaultKindParams(): Record<string, unknown> {
  return {};
}
