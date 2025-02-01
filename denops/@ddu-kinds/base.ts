import type { ActionArguments, ActionFlags } from "../ddu/types.ts";
import { BaseKind } from "../ddu/base/kind.ts";

type Params = Record<string, never>;

export class Kind extends BaseKind<Params> {
  override actions: Record<
    string,
    (args: ActionArguments<Params>) => Promise<ActionFlags>
  > = {};

  override params(): Params {
    return {};
  }
}
