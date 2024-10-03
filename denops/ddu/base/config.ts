import type { ContextBuilder } from "../context.ts";
import type { DduAliasType } from "../types.ts";
import type { Denops } from "jsr:@denops/std@~7.2.0";

export type ConfigArguments = {
  denops: Denops;
  contextBuilder: ContextBuilder;
  setAlias: (type: DduAliasType, alias: string, base: string) => void;
};

export abstract class BaseConfig {
  apiVersion = 1;

  config(_args: ConfigArguments): void | Promise<void> {}
}
