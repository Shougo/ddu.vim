import type {
  BaseParams,
  Context,
  DduFilterItems,
  DduItem,
  DduOptions,
  FilterOptions,
  SourceOptions,
} from "../types.ts";

import type { Denops } from "@denops/std";

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

  /**
   * Set to `true` on a filter subclass to declare that the filter can safely
   * run on independent item-chunks in parallel.
   *
   * A filter is considered parallel-safe when it processes every item
   * independently (e.g. only annotates highlights) and never relies on the
   * relative order of, or the total count of, items passed to it.  Typical
   * filters that *remove* items (matchers) should leave this flag unset or
   * set it to `false`.
   *
   * Example:
   * ```ts
   * export class Filter extends BaseFilter<Params> {
   *   static override parallelSafe = true;
   *   // ...
   * }
   * ```
   */
  static parallelSafe = false;

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
