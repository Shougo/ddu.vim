import type {
  BaseParams,
  Context,
  DduFilterItems,
  DduItem,
  DduOptions,
  FilterOptions,
  SourceOptions,
} from "../types.ts";
import type { Denops } from "jsr:@denops/std@~7.0.3";

export type OnInitArguments<Params extends BaseParams> = {
  denops: Denops;
  filterOptions: FilterOptions;
  filterParams: Params;
};

export type OnRefreshItemsArguments<Params extends BaseParams> = {
  denops: Denops;
  filterOptions: FilterOptions;
  filterParams: Params;
};

export type FilterArguments<Params extends BaseParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  filterOptions: FilterOptions;
  filterParams: Params;
  input: string;
  items: DduItem[];
};

export abstract class BaseFilter<Params extends BaseParams> {
  apiVersion = 3;

  name = "";
  path = "";
  isInitialized = false;

  onInit(_args: OnInitArguments<Params>): void | Promise<void> {}

  onRefreshItems(
    _args: OnRefreshItemsArguments<Params>,
  ): void | Promise<void> {}

  abstract filter(
    {}: FilterArguments<Params>,
  ): DduFilterItems | Promise<DduFilterItems>;

  abstract params(): Params;
}

export function defaultFilterOptions(): FilterOptions {
  return {
    minInputLength: 0,
  };
}
