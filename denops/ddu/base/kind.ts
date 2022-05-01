import {
  ActionOptions,
  Actions,
  DduItem,
  KindOptions,
  Previewer,
} from "../types.ts";
import { Denops } from "../deps.ts";

export abstract class BaseKind<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  actions: Actions<Params> = {};

  abstract params(): Params;

  getPreviewer(
    _denops: Denops,
    _item: DduItem,
    _param: unknown,
  ): Promise<Previewer | undefined> {
    return Promise.resolve(undefined);
  }
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
