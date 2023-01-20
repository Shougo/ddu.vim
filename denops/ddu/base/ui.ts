import {
  ActionFlags,
  Context,
  DduItem,
  DduOptions,
  SourceInfo,
  UiOptions,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type BaseUiParams = Record<string, unknown>;

export type UiActions<Params extends BaseUiParams> = Record<
  string,
  (args: ActionArguments<Params>) => Promise<ActionFlags>
>;

export type OnInitArguments<Params extends BaseUiParams> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type RefreshItemsArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  sources: SourceInfo[];
  items: DduItem[];
};

export type CollapseItemArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  item: DduItem;
};

export type ExpandItemArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  parent: DduItem;
  children: DduItem[];
};

export type SearchItemArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  item: DduItem;
};

export type RedrawArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type QuitArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type ActionArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  actionParams: unknown;
};

export abstract class BaseUi<
  Params extends BaseUiParams,
> {
  name = "";
  path = "";
  isInitialized = false;

  apiVersion = 1;

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  async refreshItems(_args: RefreshItemsArguments<Params>): Promise<void> {}

  async collapseItem(_args: CollapseItemArguments<Params>): Promise<void> {}

  async expandItem(_args: ExpandItemArguments<Params>): Promise<void> {}

  async searchItem(_args: SearchItemArguments<Params>): Promise<void> {}

  async redraw(_args: RedrawArguments<Params>): Promise<void> {}

  async quit(_args: QuitArguments<Params>): Promise<void> {}

  actions: UiActions<Params> = {};

  abstract params(): Params;
}

export function defaultUiOptions(): UiOptions {
  return {
    defaultAction: "default",
    persist: false,
    toggle: false,
  };
}
