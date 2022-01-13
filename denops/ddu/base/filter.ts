import { DduItem, DduOptions, FilterOptions, SourceOptions } from "../types.ts";
import { Denops } from "../deps.ts";

export type OnInitArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  filterOptions: FilterOptions;
  filterParams: Params;
};

export type FilterArguments<Params extends Record<string, unknown>> = {
  denops: Denops;
  options: DduOptions;
  sourceOptions: SourceOptions;
  filterOptions: FilterOptions;
  filterParams: Params;
  input: string;
  items: DduItem[];
};

export abstract class BaseFilter<Params extends Record<string, unknown>> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  async onInit(_args: OnInitArguments<Params>): Promise<void> {}

  abstract filter({}: FilterArguments<Params>): Promise<DduItem[]>;

  abstract params(): Params;
}

export function defaultFilterOptions(): FilterOptions {
  return {
    placeholder: undefined,
  };
}

export function defaultFilterParams(): Record<string, unknown> {
  return {};
}
