import type {
  ActionOptions,
  Actions,
  DduItem,
  DduOptions,
  KindOptions,
  PreviewContext,
  Previewer,
} from "../types.ts";
import type { Denops } from "../deps.ts";

export type BaseKindParams = Record<string, unknown>;

export type GetPreviewerArguments = {
  denops: Denops;
  options: DduOptions;
  actionParams: unknown;
  previewContext: PreviewContext;
  item: DduItem;
};

export abstract class BaseKind<
  Params extends BaseKindParams,
> {
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
