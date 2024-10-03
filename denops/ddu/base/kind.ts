import type {
  ActionOptions,
  Actions,
  BaseParams,
  DduItem,
  DduOptions,
  KindOptions,
  PreviewContext,
  Previewer,
} from "../types.ts";

import type { Denops } from "jsr:@denops/std@~7.2.0";

export type GetPreviewerArguments = {
  denops: Denops;
  options: DduOptions;
  actionParams: BaseParams;
  previewContext: PreviewContext;
  item: DduItem;
};

export abstract class BaseKind<Params extends BaseParams> {
  apiVersion = 2;

  name = "";
  path = "";
  isInitialized = false;

  abstract actions: Actions<Params>;

  abstract params(): Params;

  getPreviewer(
    {}: GetPreviewerArguments,
  ): Promise<Previewer | undefined> {
    return Promise.resolve(undefined);
  }
}

export function defaultKindOptions(): KindOptions {
  return {
    actions: {},
    defaultAction: "",
  };
}

export function defaultActionOptions(): ActionOptions {
  return {
    quit: true,
  };
}
