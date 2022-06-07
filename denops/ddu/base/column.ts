import { ColumnOptions, DduItem, DduOptions, ItemHighlight } from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  columnOptions: ColumnOptions;
  columnParams: Params;
};

export type GetLengthArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  columnOptions: ColumnOptions;
  columnParams: Params;
  items: DduItem[];
};

export type GetTextArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  columnOptions: ColumnOptions;
  columnParams: Params;
  startCol: number;
  endCol: number;
  item: DduItem;
};

export type GetTextResult = {
  text: string;
  highlights?: ItemHighlight[];
};

export abstract class BaseColumn<Params extends Record<string, unknown>> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  abstract getLength({}: GetLengthArguments<Params>): Promise<number>;

  abstract getText({}: GetTextArguments<Params>): Promise<GetTextResult>;

  abstract params(): Params;
}

export function defaultColumnOptions(): ColumnOptions {
  return {
    placeholder: undefined,
  };
}

export function defaultColumnParams(): Record<string, unknown> {
  return {};
}
