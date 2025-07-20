import type { ContextBuilder, DduAliasType } from "../types.ts";
import type { Denops } from "@denops/std";

export type ConfigArguments = {
  denops: Denops;
  contextBuilder: ContextBuilder;
  setAlias: (
    name: string,
    type: DduAliasType,
    alias: string,
    base: string,
  ) => void;
};

export abstract class BaseConfig {
  apiVersion = 1;

  config(_args: ConfigArguments): void | Promise<void> {}
}
