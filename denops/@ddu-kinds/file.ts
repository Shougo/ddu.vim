import { ActionFlags, BaseKind, DduItem } from "../ddu/types.ts";
import { Denops } from "../ddu/deps.ts";
import { ActionArguments } from "../ddu/base/kind.ts";

type ActionData = {
  path: string;
};

type Params = Record<never, never>;

export class Kind extends BaseKind<Params> {
  actions: Record<
    string,
    (args: ActionArguments<Params>) => Promise<ActionFlags>
  > = {
    open: async (args: { denops: Denops; items: DduItem[] }) => {
      for (const item of args.items) {
        const action = item?.action as ActionData;
        const path = action.path == null ? item.word : action.path;
        await args.denops.call("ddu#util#execute_path", "edit", path);
      }

      return Promise.resolve(ActionFlags.None);
    },
  };

  params(): Params {
    return {};
  }
}
