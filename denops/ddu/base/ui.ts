import { UiOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export abstract class BaseUi<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

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
