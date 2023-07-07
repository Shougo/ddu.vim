import {
  ActionOptions,
  Actions,
  DduItem,
  KindOptions,
  PreviewContext,
  Previewer,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type BaseKindParams = Record<string, unknown>;

export type GetPreviewerArguments = {
  denops: Denops;
  previewContext: PreviewContext;
  actionParams: unknown;
  item: DduItem;
};

export abstract class BaseKind<
  Params extends BaseKindParams,
> {
  name = "";
  isInitialized = false;

  apiVersion = 2;

  actions: Actions<Params> = {};

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
