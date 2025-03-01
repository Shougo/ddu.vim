import type {
  BaseParams,
  Context,
  DduItem,
  DduOptions,
  SourceInfo,
  UiActionCallback,
  UiOptions,
} from "../types.ts";

import type { Denops } from "jsr:@denops/std@~7.5.0";

export type UiActions<Params extends BaseParams> = Record<
  string,
  UiActionCallback<Params>
>;

export type OnInitArguments<Params extends BaseParams> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type OnBeforeActionArguments<Params extends BaseParams> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type OnAfterActionArguments<Params extends BaseParams> = {
  denops: Denops;
  uiOptions: UiOptions;
  uiParams: Params;
};

type BaseUiArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  uiOptions: UiOptions;
  uiParams: Params;
};

export type RefreshItemsArguments<Params extends BaseParams> =
  & BaseUiArguments<Params>
  & {
    sources: SourceInfo[];
    items: DduItem[];
  };

export type CollapseItemArguments<Params extends BaseParams> =
  & BaseUiArguments<Params>
  & {
    item: DduItem;
  };

export type ExpandItemArguments<Params extends BaseParams> =
  & BaseUiArguments<Params>
  & {
    parent: DduItem;
    children: DduItem[];
    isGrouped: boolean;
  };

export type SearchItemArguments<Params extends BaseParams> =
  & BaseUiArguments<Params>
  & {
    item: DduItem;
  };

export type RedrawArguments<Params extends BaseParams> = BaseUiArguments<
  Params
>;

export type QuitArguments<Params extends BaseParams> = BaseUiArguments<Params>;

export type VisibleArguments<Params extends BaseParams> =
  & BaseUiArguments<Params>
  & {
    tabNr: number;
  };

export type WinidArguments<Params extends BaseParams> = BaseUiArguments<Params>;

export type UpdateCursorArguments<Params extends BaseParams> = BaseUiArguments<
  Params
>;

export type ClearSelectedItemsArguments<Params extends BaseParams> =
  BaseUiArguments<Params>;

export abstract class BaseUi<Params extends BaseParams> {
  apiVersion = 2;

  name = "";
  path = "";
  isInitialized = false;
  prevDone = false;

  onInit(_args: OnInitArguments<Params>): void | Promise<void> {}
  onBeforeAction(
    _args: OnBeforeActionArguments<Params>,
  ): void | Promise<void> {}
  onAfterAction(_args: OnAfterActionArguments<Params>): void | Promise<void> {}

  refreshItems(_args: RefreshItemsArguments<Params>): void | Promise<void> {}

  collapseItem(
    _args: CollapseItemArguments<Params>,
  ): number | Promise<number> {
    return 0;
  }

  expandItem(_args: ExpandItemArguments<Params>): number | Promise<number> {
    return 0;
  }

  searchItem(_args: SearchItemArguments<Params>): void | Promise<void> {}

  redraw(_args: RedrawArguments<Params>): void | Promise<void> {}

  quit(_args: QuitArguments<Params>): void | Promise<void> {}

  visible(_args: VisibleArguments<Params>): boolean | Promise<boolean> {
    return false;
  }

  winIds(_args: WinidArguments<Params>): number[] | Promise<number[]> {
    return [];
  }

  updateCursor(_args: UpdateCursorArguments<Params>): void | Promise<void> {}

  clearSelectedItems(
    _args: ClearSelectedItemsArguments<Params>,
  ): void | Promise<void> {}

  abstract actions: UiActions<Params>;

  abstract params(): Params;
}

export function defaultUiOptions(): UiOptions {
  return {
    actions: {},
    defaultAction: "default",
    filterInputFunc: "input",
    filterInputOptsFunc: "",
    filterUpdateCallback: "",
    filterUpdateMax: 0,
    filterPrompt: "",
    persist: false,
    toggle: false,
  };
}
