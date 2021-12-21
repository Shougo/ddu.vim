import { Denops } from "../deps.ts";

export abstract class BaseKind<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  abstract params(): Params;
}

export function defaultUiParams(): Record<string, unknown> {
  return {};
}
