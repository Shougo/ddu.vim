import {
  ActionOptions,
  Actions,
  DduItem,
  KindOptions,
  PreviewContext,
  Previewer,
} from "../types.ts";
import { Denops } from "../deps.ts";

export type GetPreviewerArguments = {
  denops: Denops;
  previewContext: PreviewContext;
  actionParams: unknown;
  item: DduItem;
};

export abstract class BaseKind<
  Params extends Record<string, unknown>,
> {
  name = "";
  isInitialized = false;

  apiVersion = 1;

  actions: Actions<Params> = {};

  abstract params(): Params;

  // deno-lint-ignore require-await
  async getPreviewer(
    {}: GetPreviewerArguments,
  ): Promise<Previewer | undefined> {
    return undefined;
  }
}

export function defaultKindOptions(): KindOptions {
  return {
    actions: {},
    defaultAction: "",
  };
}
export function defaultKindParams(): Record<string, unknown> {
  return {};
}

export function defaultActionOptions(): ActionOptions {
  return {
    quit: true,
  };
}
