import { DduItem, DduOptions, UiOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type RedrawArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  items: DduItem[];
};

export type ActionArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  actionParams: unknown;
};

export abstract class BaseUi<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  async redraw(_args: RedrawArguments<Params>): Promise<void> {}

  actions: Record<string, (args: ActionArguments<Params>) => Promise<void>> =
    {};

  abstract params(): Params;
}

export function defaultUiOptions(): UiOptions {
  return {
    defaultAction: "default",
  };
}

export function defaultUiParams(): Record<string, unknown> {
  return {};
}
