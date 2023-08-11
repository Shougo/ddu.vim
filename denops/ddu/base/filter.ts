import {
  Context,
  DduFilterItems,
  DduItem,
  DduOptions,
  FilterOptions,
  SourceOptions,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type BaseFilterParams = Record<string, unknown>;

export type OnInitArguments<Params extends BaseFilterParams> = {
  denops: Denops;
  filterOptions: FilterOptions;
  filterParams: Params;
};

export type OnRefreshItemsArguments<Params extends BaseFilterParams> = {
  denops: Denops;
  filterOptions: FilterOptions;
  filterParams: Params;
};

export type FilterArguments<Params extends BaseFilterParams> = {
  denops: Denops;
  context: Context;
  options: DduOptions;
  sourceOptions: SourceOptions;
  filterOptions: FilterOptions;
  filterParams: Params;
  input: string;
  items: DduItem[];
};

export abstract class BaseFilter<Params extends BaseFilterParams> {
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
    placeholder: undefined,
  };
}
