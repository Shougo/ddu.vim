import {
  Context,
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
  name = "";
  path = "";
  isInitialized = false;

  apiVersion = 2;

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  async onRefreshItems(_args: OnRefreshItemsArguments<Params>): Promise<void> {}

  abstract filter({}: FilterArguments<Params>): Promise<DduItem[]>;

  abstract params(): Params;
}

export function defaultFilterOptions(): FilterOptions {
  return {
    placeholder: undefined,
  };
}
