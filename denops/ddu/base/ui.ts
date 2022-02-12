import {
  Actions,
  Context,
  DduItem,
  DduOptions,
  UiOptions,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type RefreshItemsArguments<Params extends Record<string, unknown>> = {
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  items: DduItem[];
};

export type RedrawArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type QuitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type ActionArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  context: Context;
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

  refreshItems(_args: RefreshItemsArguments<Params>): void {}

  async redraw(_args: RedrawArguments<Params>): Promise<void> {}

  async quit(_args: QuitArguments<Params>): Promise<void> {}

  actions: Actions<Params> = {};

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
