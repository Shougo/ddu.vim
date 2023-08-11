import { ContextBuilder } from "../context.ts";
import { DduAliasType } from "../types.ts";
import { Denops } from "../deps.ts";

export type ConfigArguments = {
  denops: Denops;
  contextBuilder: ContextBuilder;
  setAlias: (type: DduAliasType, alias: string, base: string) => void;
};

export abstract class BaseConfig {
  apiVersion = 1;

  config(_args: ConfigArguments): void | Promise<void> {}
}
