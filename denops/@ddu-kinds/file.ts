import { BaseKind, DduItem } from "../ddu/types.ts";
import { Denops } from "../ddu/deps.ts";
import { ActionArguments } from "../ddu/base/kind.ts";

export class Kind extends BaseKind<{}> {
  actions: Record<string, (args: ActionArguments<{}>) => Promise<void>> = {
    open: async (args: { denops: Denops; items: DduItem[] }) => {
      for (const item of args.items) {
        await args.denops.call("ddu#util#execute_path", "edit", item.word);
      }
    },
  };

  params(): {} {
    return {};
  }
}
