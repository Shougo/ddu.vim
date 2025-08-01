import type {
  BaseParams,
  ColumnOptions,
  Context,
  DduItem,
  DduOptions,
  ItemHighlight,
} from "../types.ts";

import type { Denops } from "@denops/std";

export type OnInitArguments<Params extends BaseParams> = {
  denops: Denops;
  columnOptions: ColumnOptions;
  columnParams: Params;
};

export type GetBaseTextArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  columnOptions: ColumnOptions;
  columnParams: Params;
  item: DduItem;
};

export type GetLengthArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  columnOptions: ColumnOptions;
  columnParams: Params;
  items: DduItem[];
};

export type GetTextArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  columnOptions: ColumnOptions;
  columnParams: Params;
  startCol: number;
  endCol: number;
  item: DduItem;
  baseText?: string;
};

export type GetTextResult = {
  text: string;
  highlights?: ItemHighlight[];
};

export abstract class BaseColumn<Params extends BaseParams> {
  apiVersion = 2;

  name = "";
  path = "";
  isInitialized = false;

  onInit(_args: OnInitArguments<Params>): void | Promise<void> {}

  abstract getBaseText(
    {}: GetBaseTextArguments<Params>,
  ): string | Promise<string>;

  abstract getLength({}: GetLengthArguments<Params>): number | Promise<number>;

  abstract getText(
    {}: GetTextArguments<Params>,
  ): GetTextResult | Promise<GetTextResult>;

  abstract params(): Params;
}

export function defaultColumnOptions(): ColumnOptions {
  return {
    placeholder: undefined,
  };
}
