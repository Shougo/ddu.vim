import {
  BaseActionParams,
  Context,
  Ddu,
  DduItem,
  DduOptions,
  PreviewContext,
  Previewer,
  SourceInfo,
  UiActionCallback,
  UiOptions,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type BaseUiParams = Record<string, unknown>;

export type UiActions<Params extends BaseUiParams> = Record<
  string,
  UiActionCallback<Params>
>;

export type OnInitArguments<Params extends BaseUiParams> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type OnBeforeActionArguments<Params extends BaseUiParams> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type OnAfterActionArguments<Params extends BaseUiParams> = {
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

export type VisibleArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  tabNr: number;
};

export type WinidArguments<Params extends BaseUiParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type UiActionArguments<Params extends BaseUiParams> = {
  denops: Denops;
  ddu: Ddu;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
  actionParams: unknown;
  getPreviewer?: (
    denops: Denops,
    item: DduItem,
    actionParams: BaseActionParams,
    previewContext: PreviewContext,
  ) => Promise<Previewer | undefined>;
};

export abstract class BaseUi<
  Params extends BaseUiParams,
> {
  apiVersion = 2;

  name = "";
  path = "";
  isInitialized = false;

  onInit(_args: OnInitArguments<Params>): void | Promise<void> {}
  onBeforeAction(
    _args: OnBeforeActionArguments<Params>,
  ): void | Promise<void> {}
  onAfterAction(_args: OnAfterActionArguments<Params>): void | Promise<void> {}

  refreshItems(_args: RefreshItemsArguments<Params>): void | Promise<void> {}

  collapseItem(
    _args: CollapseItemArguments<Params>,
  ): number | Promise<number> {}

  expandItem(_args: ExpandItemArguments<Params>): number | Promise<number> {}

  searchItem(_args: SearchItemArguments<Params>): void | Promise<void> {}

  redraw(_args: RedrawArguments<Params>): void | Promise<void> {}

  quit(_args: QuitArguments<Params>): void | Promise<void> {}

  visible(_args: VisibleArguments<Params>): boolean | Promise<boolean> {
    return false;
  }

  winIds(_args: WinidArguments<Params>): number[] | Promise<number[]> {
    return [];
  }

  actions: UiActions<Params> = {};

  abstract params(): Params;
}

export function defaultUiOptions(): UiOptions {
  return {
    actions: {},
    defaultAction: "default",
    persist: false,
    toggle: false,
  };
}
