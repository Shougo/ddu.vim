import { DduCandidate, UiOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type RedrawArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  candidates: DduCandidate[];
};

export abstract class BaseUi<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  async redraw(_args: RedrawArguments<Params>): Promise<void> {}

  abstract params(): Params;
}

export function defaultUiOptions(): UiOptions {
  return {
    placeholder: undefined,
  };
}

export function defaultUiParams(): Record<string, unknown> {
  return {};
}
