import type { Actions } from "../ddu/types.ts";
import { BaseKind } from "../ddu/base/kind.ts";

type Params = Record<string, never>;

export class Kind extends BaseKind<Params> {
  override actions: Actions<Params> = {};

  override params(): Params {
    return {};
  }
}
