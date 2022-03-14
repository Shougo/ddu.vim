import { ActionOptions, Actions, KindOptions } from "../types.ts";

export abstract class BaseKind<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  actions: Actions<Params> = {};

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

export function defaultActionOptions(): ActionOptions {
  return {
    quit: true,
  };
}
